import { Registry } from 'prom-client'
import pino from 'pino'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  loadConfig,
  loadDotEnvFiles,
  loadEnv,
  riskFingerprint,
  riskFingerprintChanged,
  stableStringify,
} from '@fx42/config'
import type { Env } from '@fx42/config'
import {
  type AppContext,
  type PricePort,
  type ScamPort,
} from '@fx42/application'
import {
  DbRepos,
  SqliteUnitOfWork,
  migrate,
  openDatabase,
  quickCheck,
  recordConfigSnapshot,
  seedDemoUsers,
  type Fx42Db,
} from '@fx42/db'
import {
  AesGcmCrypto,
  BiquoteClient,
  MockScamClient,
  OidcRegistry,
  ScamClient,
} from '@fx42/clients'
import { systemClock } from '@fx42/shared'
import { PriceStore } from './price-store'
import { FeedRuntime } from './feed'
import { JobWorker } from './jobs'
import { Scheduler } from './scheduler'
import { RiskLoop } from './risk-loop'
import { ControlServer } from './control'
import { createMetrics, type Metrics } from './metrics'
import type { Logger } from './logger'

export interface RuntimeOptions {
  env?: Env
  databasePath?: string
  configFile?: string
  startLoops?: boolean
}

export class Fx42Runtime {
  readonly db: Fx42Db
  readonly ctx: AppContext
  readonly prices: PriceStore
  readonly oidc: OidcRegistry
  readonly metrics: Metrics
  readonly registry: Registry
  readonly log: Logger
  readonly startedAt = Date.now()
  private feed: FeedRuntime
  private jobs: JobWorker
  private risk: RiskLoop
  private scheduler: Scheduler
  private control: ControlServer | null = null
  private scam: ScamPort
  readonly env: Env
  private stopped = false

  constructor(options: RuntimeOptions = {}) {
    const root = findRepoRoot(process.cwd())
    if (!options.env) {
      loadDotEnvFiles([
        resolve(root, '.env.local'),
        resolve(root, '.env'),
        resolve(process.cwd(), '.env.local'),
        resolve(process.cwd(), '.env'),
      ])
    }
    this.env = options.env ?? loadEnv(process.env)
    if (!this.env.SCAM_RESERVE_TOKEN || !this.env.SCAM_RESERVE_IBAN) {
      throw new Error('SCAM_RESERVE_TOKEN and SCAM_RESERVE_IBAN must be configured')
    }
    const requestedConfig = options.configFile ?? this.env.FX42_CONFIG_FILE
    const configPath = isAbsolute(requestedConfig)
      ? requestedConfig
      : resolve(root, requestedConfig)
    const loaded = loadConfig({
      filePath: configPath,
      env: process.env,
    })
    const requestedDb = options.databasePath ?? this.env.DATABASE_PATH
    const dbPath = isAbsolute(requestedDb) ? requestedDb : resolve(root, requestedDb)
    this.db = openDatabase(dbPath)
    migrateWithRetry(this.db)
    this.registry = new Registry()
    this.metrics = createMetrics(this.registry)
    this.log = createLogger(this.env.LOG_LEVEL)
    this.prices = new PriceStore(loaded.config.risk.staleQuoteMs)
    this.scam =
      this.env.FX42_MODE === 'mock'
        ? new MockScamClient()
        : new ScamClient({ baseUrl: this.env.SCAM_BASE_URL })
    const crypto = new AesGcmCrypto(this.env.FX42_ENCRYPTION_KEY!)
    const biquote = new BiquoteClient(this.env.BIQUOTE_REST_URL)
    this.oidc = new OidcRegistry(
      loaded.config.auth.providers
        .filter((p) => p.enabled)
        .map((p) => ({
          id: p.id,
          kind: p.kind,
          issuer: p.issuer,
          clientId: p.clientId,
          clientSecret: process.env[p.clientSecretEnv] ?? 'missing-secret',
          scopes: p.scopes,
          mntClaim: p.mntClaim,
        })),
    )
    const repos = new DbRepos(this.db, systemClock)
    this.ctx = {
      repos,
      uow: new SqliteUnitOfWork(this.db, systemClock),
      config: loaded.config,
      clock: systemClock,
      prices: this.prices as PricePort,
      scam: this.scam,
      crypto,
      reserve: {
        iban: this.env.SCAM_RESERVE_IBAN!,
        token: this.env.SCAM_RESERVE_TOKEN!,
        scamAccountId: null,
      },
    }
    this.checkRiskConfigChange(loaded.config)
    recordConfigSnapshot(this.db, {
      filePath: loaded.filePath,
      sourceYaml: loaded.sourceYaml,
      canonicalJson: loaded.canonicalJson,
      sourceHash: loaded.sourceHash,
      canonicalHash: loaded.canonicalHash,
      loadedBy: 'web',
      now: Date.now(),
    })
    if (this.env.FX42_MODE === 'mock') {
      seedDemoUsers(this.db, Date.now())
    }
    this.feed = new FeedRuntime(
      loaded.config,
      this.prices,
      repos,
      this.env.FX42_MODE,
      this.env.BIQUOTE_HUB_URL,
      biquote,
      this.log,
    )
    this.jobs = new JobWorker({
      ctx: this.ctx,
      log: this.log,
      metrics: this.metrics,
    })
    this.risk = new RiskLoop(this.ctx, this.jobs, this.log)
    this.scheduler = new Scheduler(this.ctx, this.jobs)
    this.control = new ControlServer(
      isAbsolute(this.env.FX42_CONTROL_SOCKET)
        ? this.env.FX42_CONTROL_SOCKET
        : resolve(root, this.env.FX42_CONTROL_SOCKET),
      (req) => this.handleControl(req),
      this.log,
    )
    this.biquote = biquote
  }

  readonly biquote: BiquoteClient

  async start(): Promise<void> {
    this.log.info({ mode: this.env.FX42_MODE, db: this.db.path }, 'starting fx42 runtime')
    await this.feed.start()
    this.jobs.start()
    this.risk.start()
    this.scheduler.start()
    try {
      this.control?.start()
    } catch (error) {
      this.log.warn({ error: (error as Error).message }, 'control socket unavailable')
    }
    this.log.info({}, 'fx42 runtime ready')
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.risk.stop()
    this.scheduler.stop()
    this.jobs.stop()
    await this.feed.stop()
    this.control?.stop()
    this.db.close()
  }

  health(): {
    ok: boolean
    db: boolean
    ready: boolean
    feed: { connected: boolean; lastTickAt: number | null }
    jobs: { pending: number; failed: number }
    uptimeMs: number
  } {
    const dbOk = quickCheck(this.db)
    const feed = this.ctx.repos.market.getFeedStatus()
    return {
      ok: dbOk,
      db: dbOk,
      ready: !this.stopped && dbOk,
      feed: { connected: feed.connected, lastTickAt: feed.lastTickAt },
      jobs: {
        pending: this.ctx.repos.jobs.countJobs('pending'),
        failed: this.ctx.repos.jobs.countJobs('failed'),
      },
      uptimeMs: Date.now() - this.startedAt,
    }
  }

  private checkRiskConfigChange(config: import('@fx42/config').Fx42Config): void {
    const row = this.ctx.repos.runtime.latestConfigSnapshot()
    if (!row) return
    const previous = (() => {
      try {
        return riskFingerprint(JSON.parse(row.canonicalJson))
      } catch {
        return null
      }
    })()
    const next = riskFingerprint(config)
    if (!riskFingerprintChanged(previous, next)) return
    const open = this.ctx.repos.trading.listOpenPositions().length
    if (open === 0) return
    if (!this.env.FX42_ALLOW_RISK_CONFIG_CHANGE) {
      throw new Error(
        `Risk configuration changed while ${open} positions are open. ` +
          'Set FX42_ALLOW_RISK_CONFIG_CHANGE=1 to start and schedule recalc-risk.',
      )
    }
    this.log.warn({ open }, 'risk config changed; recalc-risk will be scheduled')
    this.ctx.repos.jobs.enqueueJob({
      type: 'recalc-risk',
      payload: {},
      dedupeKey: `recalc-risk:${stableStringify(next)}`,
      priority: 5,
      now: Date.now(),
    })
  }

  private async handleControl(
    req: import('./control').ControlRequest,
  ): Promise<import('./control').ControlResponse> {
    const now = Date.now()
    switch (req.command) {
      case 'halt': {
        const all = Boolean(req.all)
        this.ctx.repos.runtime.setFlag(
          all ? 'halt_all' : 'halt_opening',
          '1',
          String(req.reason ?? ''),
          'ops',
          now,
        )
        this.ctx.repos.runtime.audit({
          actorId: null,
          action: all ? 'ops.halt_all' : 'ops.halt_opening',
          target: null,
          before: null,
          after: { reason: req.reason ?? null },
          ip: null,
          now,
        })
        return { ok: true, data: { haltAll: all } }
      }
      case 'resume': {
        this.ctx.repos.runtime.setFlag('halt_opening', '0', String(req.reason ?? ''), 'ops', now)
        this.ctx.repos.runtime.setFlag('halt_all', '0', String(req.reason ?? ''), 'ops', now)
        this.ctx.repos.runtime.audit({
          actorId: null,
          action: 'ops.resume',
          target: null,
          before: null,
          after: { reason: req.reason ?? null },
          ip: null,
          now,
        })
        return { ok: true }
      }
      case 'close': {
        const positionId = String(req.positionId ?? '')
        const { closePosition } = await import('@fx42/application')
        const pos = this.ctx.repos.trading.findPositionById(positionId)
        if (!pos) return { ok: false, error: 'position not found' }
        const result = closePosition(this.ctx, pos.userId, positionId, {
          reason: 'ops',
          clientOrderId: `ops:${positionId}:${now}`,
        })
        this.ctx.repos.runtime.audit({
          actorId: null,
          action: 'ops.close_position',
          target: positionId,
          before: null,
          after: { closePrice: result.closePrice },
          ip: null,
          now,
        })
        return { ok: true, data: result }
      }
      case 'status':
        return {
          ok: true,
          data: {
            feed: this.ctx.repos.market.getFeedStatus(),
            flags: {
              haltOpening: this.ctx.repos.runtime.getFlag('halt_opening'),
              haltAll: this.ctx.repos.runtime.getFlag('halt_all'),
            },
            jobs: {
              pending: this.ctx.repos.jobs.countJobs('pending'),
              failed: this.ctx.repos.jobs.countJobs('failed'),
            },
          },
        }
      default:
        return { ok: false, error: `unknown command: ${req.command}` }
    }
  }
}

function createLogger(level: string): Logger {
  return pino({ level, redact: ['token', '*.token', 'authorization', 'cookie', 'iban'] }) as Logger
}

function migrateWithRetry(db: Fx42Db, attempts = 6): void {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      migrate(db)
      return
    } catch (error) {
      lastError = error
      if (!String((error as Error).message).includes('locked')) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
  }
  throw lastError
}

function findRepoRoot(start: string): string {
  let dir = resolve(start)
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.env.INIT_CWD ?? start
}

const globalKey = Symbol.for('fx42.runtime')
type GlobalWithRuntime = typeof globalThis & {
  [globalKey]?: { runtime: Fx42Runtime | null; starting: Promise<Fx42Runtime> | null }
}

export function getRuntime(): Fx42Runtime | null {
  return (globalThis as GlobalWithRuntime)[globalKey]?.runtime ?? null
}

export async function stopRuntime(): Promise<void> {
  const global = globalThis as GlobalWithRuntime
  const state = global[globalKey]
  if (!state?.runtime) return
  const runtime = state.runtime
  state.runtime = null
  await runtime.stop()
}

export async function ensureRuntime(options: RuntimeOptions = {}): Promise<Fx42Runtime> {
  const global = globalThis as GlobalWithRuntime
  const state = (global[globalKey] ??= { runtime: null, starting: null })
  if (state.runtime) return state.runtime
  if (state.starting) return state.starting
  state.starting = (async () => {
    const runtime = new Fx42Runtime(options)
    await runtime.start()
    state.runtime = runtime
    return runtime
  })()
  try {
    return await state.starting
  } finally {
    state.starting = null
  }
}

export * from './price-store'
export * from './feed'
export * from './jobs'
export * from './scheduler'
export * from './risk-loop'
export * from './control'
export * from './logger'
export * from './metrics'
