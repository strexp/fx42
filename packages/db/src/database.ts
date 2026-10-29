import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { newId } from '@fx42/shared'
import { SCHEMA_SQL } from './schema.generated'
import type {
  AccountRow,
  CandleRow,
  CredentialRow,
  DepositRow,
  FillRow,
  IdentityRow,
  JobRow,
  LiquidationRow,
  MarginEventRow,
  NotificationRow,
  OrderRow,
  PositionRow,
  PriceRow,
  ScamAccountRow,
  TriggerRow,
  UserRow,
  WalletRow,
  WithdrawalRow,
} from './types'

export type SqliteDatabase = Database.Database

export interface DbOptions {
  readonly?: boolean
  timeoutMs?: number
}

export interface Fx42Db {
  raw: SqliteDatabase
  path: string
  close(): void
}

export function openDatabase(path: string, options: DbOptions = {}): Fx42Db {
  let raw: SqliteDatabase
  try {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })
    raw = new Database(path, {
      readonly: options.readonly ?? false,
      timeout: options.timeoutMs ?? 5000,
      fileMustExist: options.readonly ?? false,
    })
  } catch (error) {
    throw new Error(
      `Cannot open SQLite database at ${path}: ${(error as Error).message}. ` +
        'Ensure the parent directory exists and is writable by the runtime user.',
      { cause: error },
    )
  }
  raw.defaultSafeIntegers(true)
  if (!options.readonly) {
    raw.pragma('journal_mode = WAL')
    raw.pragma('synchronous = FULL')
    raw.pragma('foreign_keys = ON')
    raw.pragma('busy_timeout = 5000')
    raw.pragma('temp_store = MEMORY')
    raw.pragma('wal_autocheckpoint = 1000')
  }
  return { raw, path, close: () => raw.close() }
}

export function migrate(db: Fx42Db, options: { seed?: boolean } = {}): void {
  db.raw.exec(SCHEMA_SQL)
  // Removed in v2: event outbox and per-scope idempotency keys are no longer used.
  db.raw.exec('DROP TABLE IF EXISTS outbox_events; DROP TABLE IF EXISTS idempotency_keys;')
  // Removed in v3: there is no administrator role; the reserve account is
  // configured exclusively through environment variables.
  db.raw.exec('DROP INDEX IF EXISTS one_admin;')
  const userColumns = db.raw.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
  if (userColumns.some((column) => column.name === 'is_admin')) {
    db.raw.exec('ALTER TABLE users DROP COLUMN is_admin;')
  }
  dropLegacyIdentityColumns(db)
  const existing = db.raw
    .prepare('SELECT version FROM schema_migrations WHERE version = 1')
    .get() as { version: bigint } | undefined
  if (!existing) {
    db.raw
      .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)')
      .run('initial', BigInt(Date.now()))
  }
  db.raw
    .prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (2, ?, ?)')
    .run('drop-outbox-and-idempotency', BigInt(Date.now()))
  db.raw
    .prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (3, ?, ?)')
    .run('drop-admin-role', BigInt(Date.now()))
  db.raw
    .prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (4, ?, ?)')
    .run('drop-legacy-identity-columns', BigInt(Date.now()))
  if (options.seed ?? true) seedSystem(db, Date.now())
}

/**
 * Rebuild the identity tables without the legacy provider-number column.
 *
 * SQLite cannot drop a column that is referenced by a CHECK constraint, so the
 * tables are recreated and the rows copied across. Foreign keys are disabled
 * for the duration of the rebuild and verified before the transaction commits.
 */
function dropLegacyIdentityColumns(db: Fx42Db): void {
  const userColumns = db.raw.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
  const identityColumns = db.raw
    .prepare('PRAGMA table_info(user_identities)')
    .all() as Array<{ name: string }>
  const usersNeedRebuild = userColumns.some((column) => column.name === 'asn')
  const identitiesNeedRebuild = identityColumns.some((column) => column.name === 'asn')
  if (!usersNeedRebuild && !identitiesNeedRebuild) return

  db.raw.pragma('foreign_keys = OFF')
  try {
    db.raw.exec('BEGIN')
    if (usersNeedRebuild) {
      db.raw.exec(`
        CREATE TABLE users_v4 (
          id                      TEXT PRIMARY KEY,
          active_mnt              TEXT,
          display_name            TEXT,
          email                   TEXT,
          locale                  TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('zh-CN','en')),
          status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
          session_version         INTEGER NOT NULL DEFAULT 1,
          default_mode            TEXT NOT NULL DEFAULT 'virtual' CHECK (default_mode IN ('real','virtual')),
          onboarding_completed_at INTEGER,
          last_login_at           INTEGER,
          created_at              INTEGER NOT NULL
        ) STRICT;
        INSERT INTO users_v4
          (id, active_mnt, display_name, email, locale, status, session_version,
           default_mode, onboarding_completed_at, last_login_at, created_at)
        SELECT id, active_mnt, display_name, email, locale, status, session_version,
               default_mode, onboarding_completed_at, last_login_at, created_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_v4 RENAME TO users;
        CREATE UNIQUE INDEX IF NOT EXISTS users_mnt ON users (active_mnt) WHERE active_mnt IS NOT NULL;
      `)
    }
    if (identitiesNeedRebuild) {
      db.raw.exec(`
        CREATE TABLE user_identities_v4 (
          id            TEXT PRIMARY KEY,
          user_id       TEXT NOT NULL REFERENCES users(id),
          provider_id   TEXT NOT NULL,
          provider_kind TEXT NOT NULL CHECK (provider_kind IN ('dn42','generic')),
          subject       TEXT NOT NULL,
          active_mnt    TEXT,
          email         TEXT,
          created_at    INTEGER NOT NULL,
          last_login_at INTEGER,
          UNIQUE (provider_id, subject),
          CHECK ((provider_kind = 'dn42' AND active_mnt IS NOT NULL) OR
                 (provider_kind = 'generic' AND active_mnt IS NULL))
        ) STRICT;
        INSERT INTO user_identities_v4
          (id, user_id, provider_id, provider_kind, subject, active_mnt, email,
           created_at, last_login_at)
        SELECT id, user_id, provider_id, provider_kind, subject, active_mnt, email,
               created_at, last_login_at
        FROM user_identities;
        DROP TABLE user_identities;
        ALTER TABLE user_identities_v4 RENAME TO user_identities;
        CREATE INDEX IF NOT EXISTS user_identities_user ON user_identities (user_id);
        CREATE INDEX IF NOT EXISTS user_identities_mnt ON user_identities (active_mnt) WHERE active_mnt IS NOT NULL;
      `)
    }
    const violations = db.raw.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('foreign key check failed after identity migration')
    db.raw.exec('COMMIT')
  } catch (error) {
    db.raw.exec('ROLLBACK')
    throw error
  } finally {
    db.raw.pragma('foreign_keys = ON')
  }
}

const SYSTEM_KINDS = [
  { kind: 'external_reserve', allowNegative: true },
  { kind: 'fee_income', allowNegative: false },
  { kind: 'insurance_fund', allowNegative: false },
  { kind: 'withdrawal_pending', allowNegative: false },
  { kind: 'margin_pool', allowNegative: false },
  { kind: 'exchange_pnl', allowNegative: true },
  { kind: 'bad_debt', allowNegative: true },
] as const

export function seedSystem(db: Fx42Db, now: number): void {
  const insert = db.raw.prepare(
    `INSERT OR IGNORE INTO wallets (id, account_id, mode, kind, balance_micros, allow_negative, updated_at)
     VALUES (?, NULL, ?, ?, 0, ?, ?)`,
  )
  for (const mode of ['real', 'virtual'] as const) {
    for (const def of SYSTEM_KINDS) {
      insert.run(`sys:${mode}:${def.kind}`, mode, def.kind, def.allowNegative ? 1 : 0, BigInt(now))
    }
  }
  db.raw
    .prepare(
      'INSERT OR IGNORE INTO feed_status (id, connected, reconnects, updated_at) VALUES (1, 0, 0, ?)',
    )
    .run(BigInt(now))
  db.raw
    .prepare(
      'INSERT OR IGNORE INTO deposit_sync_state (id, last_scam_tx_id, last_scan_at, updated_at) VALUES (1, NULL, NULL, ?)',
    )
    .run(BigInt(now))
  const flag = db.raw.prepare(
    'INSERT OR IGNORE INTO runtime_flags (key, value, reason, updated_by, updated_at) VALUES (?, ?, NULL, ?, ?)',
  )
  flag.run('halt_opening', '0', 'system', BigInt(now))
  flag.run('halt_all', '0', 'system', BigInt(now))
}

export const n = (v: unknown): number => {
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return v
  if (v === null || v === undefined) return 0
  return Number(v)
}
export const b = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  if (typeof v === 'string') return BigInt(v)
  return 0n
}
export const nb = (v: unknown): bigint | null => (v === null || v === undefined ? null : b(v))
export const nn = (v: unknown): number | null => (v === null || v === undefined ? null : n(v))

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

export function withTransaction<T>(db: Fx42Db, fn: () => T, retries = 3): T {
  for (let attempt = 0; ; attempt++) {
    try {
      db.raw.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        db.raw.exec('COMMIT')
        return result
      } catch (error) {
        try {
          db.raw.exec('ROLLBACK')
        } catch {
          // transaction may already be rolled back
        }
        throw error
      }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'SQLITE_BUSY' && attempt < retries - 1) {
        sleep([10, 50, 200][attempt] ?? 200)
        continue
      }
      throw error
    }
  }
}

export function recordConfigSnapshot(
  db: Fx42Db,
  input: {
    filePath: string
    sourceYaml: string
    canonicalJson: string
    sourceHash: string
    canonicalHash: string
    loadedBy: string
    now: number
  },
): string {
  const existing = db.raw
    .prepare('SELECT id FROM config_snapshots WHERE source_hash = ? AND canonical_hash = ?')
    .get(input.sourceHash, input.canonicalHash) as { id: string } | undefined
  if (existing) return existing.id
  const id = newId()
  db.raw
    .prepare(
      `INSERT INTO config_snapshots
        (id, file_path, source_yaml, canonical_json, source_hash, canonical_hash, loaded_by, loaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.filePath,
      input.sourceYaml,
      input.canonicalJson,
      input.sourceHash,
      input.canonicalHash,
      input.loadedBy,
      BigInt(input.now),
    )
  return id
}

export function quickCheck(db: Fx42Db): boolean {
  const rows = db.raw.pragma('quick_check') as Array<{ quick_check: string }>
  return rows.length === 1 && rows[0]?.quick_check === 'ok'
}

export function mapUser(r: Record<string, unknown>): UserRow {
  return {
    id: String(r.id),
    activeMnt: r.active_mnt as string | null,
    displayName: r.display_name as string | null,
    email: r.email as string | null,
    locale: r.locale as 'zh-CN' | 'en',
    status: r.status as UserRow['status'],
    sessionVersion: n(r.session_version),
    defaultMode: r.default_mode as UserRow['defaultMode'],
    onboardingCompletedAt: nn(r.onboarding_completed_at),
    lastLoginAt: nn(r.last_login_at),
    createdAt: n(r.created_at),
  }
}

export function mapIdentity(r: Record<string, unknown>): IdentityRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    providerId: String(r.provider_id),
    providerKind: r.provider_kind as 'dn42' | 'generic',
    subject: String(r.subject),
    activeMnt: r.active_mnt as string | null,
    email: r.email as string | null,
    createdAt: n(r.created_at),
    lastLoginAt: nn(r.last_login_at),
  }
}

export function mapAccount(r: Record<string, unknown>): AccountRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    mode: r.mode as AccountRow['mode'],
    currency: r.currency as AccountRow['currency'],
    status: r.status as AccountRow['status'],
    createdAt: n(r.created_at),
  }
}

export function mapWallet(r: Record<string, unknown>): WalletRow {
  return {
    id: String(r.id),
    accountId: (r.account_id as string | null) ?? null,
    mode: r.mode as WalletRow['mode'],
    kind: String(r.kind),
    balanceMicros: b(r.balance_micros),
    allowNegative: n(r.allow_negative) === 1,
    updatedAt: n(r.updated_at),
  }
}

export function mapCredential(r: Record<string, unknown>): CredentialRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    tokenCipher: String(r.token_cipher),
    keyVersion: n(r.key_version),
    tokenHint: String(r.token_hint),
    scamUserId: nn(r.scam_user_id),
    scamUsername: r.scam_username as string | null,
    status: r.status as CredentialRow['status'],
    verifiedAt: nn(r.verified_at),
    lastUsedAt: nn(r.last_used_at),
    revokedAt: nn(r.revoked_at),
    createdAt: n(r.created_at),
  }
}

export function mapScamAccount(r: Record<string, unknown>): ScamAccountRow {
  return {
    id: String(r.id),
    credentialId: String(r.credential_id),
    scamAccountId: n(r.scam_account_id),
    iban: String(r.iban),
    accountName: r.account_name as string | null,
    balanceSnapshotMicros: nb(r.balance_snapshot_micros),
    isPrimary: n(r.is_primary) === 1,
    syncedAt: nn(r.synced_at),
  }
}

export function mapOrder(r: Record<string, unknown>): OrderRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    symbol: String(r.symbol),
    side: r.side as OrderRow['side'],
    type: r.type as OrderRow['type'],
    reduceOnly: n(r.reduce_only) === 1,
    unitsMicros: b(r.units_micros),
    leverage: n(r.leverage),
    limitPrice: r.limit_price as string | null,
    stopPrice: r.stop_price as string | null,
    status: r.status as OrderRow['status'],
    clientOrderId: String(r.client_order_id),
    filledPrice: r.filled_price as string | null,
    notionalMicros: b(r.notional_micros),
    feeMicros: b(r.fee_micros),
    filledAt: nn(r.filled_at),
    rejectReason: r.reject_reason as string | null,
    positionId: r.position_id as string | null,
    expiresAt: nn(r.expires_at),
    createdAt: n(r.created_at),
  }
}

export function mapPosition(r: Record<string, unknown>): PositionRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    symbol: String(r.symbol),
    side: r.side as PositionRow['side'],
    unitsMicros: b(r.units_micros),
    entryPrice: String(r.entry_price),
    leverage: n(r.leverage),
    maintenanceRatioBps: n(r.maintenance_ratio_bps),
    marginMicros: b(r.margin_micros),
    lastFinancingAt: nn(r.last_financing_at),
    autoCloseRatioBps: nn(r.auto_close_ratio_bps),
    openFeeMicros: b(r.open_fee_micros),
    realizedPnlMicros: b(r.realized_pnl_micros),
    status: r.status as PositionRow['status'],
    closePrice: r.close_price as string | null,
    closeReason: r.close_reason as string | null,
    openedAt: n(r.opened_at),
    closedAt: nn(r.closed_at),
    version: n(r.version),
  }
}

export function mapFill(r: Record<string, unknown>): FillRow {
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    positionId: r.position_id as string | null,
    symbol: String(r.symbol),
    side: r.side as FillRow['side'],
    action: String(r.action),
    unitsMicros: b(r.units_micros),
    price: String(r.price),
    notionalMicros: b(r.notional_micros),
    feeMicros: b(r.fee_micros),
    realizedPnlMicros: b(r.realized_pnl_micros),
    createdAt: n(r.created_at),
  }
}

export function mapDeposit(r: Record<string, unknown>): DepositRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    mode: r.mode as DepositRow['mode'],
    method: r.method as DepositRow['method'],
    scamTxId: nn(r.scam_tx_id),
    amountMicros: b(r.amount_micros),
    receivedMicros: nb(r.received_micros),
    feeMicros: b(r.fee_micros),
    creditedMicros: nb(r.credited_micros),
    requestId: r.request_id as string | null,
    status: r.status as DepositRow['status'],
    memoCode: r.memo_code as string | null,
    expiresAt: nn(r.expires_at),
    raw: r.raw as string | null,
    createdAt: n(r.created_at),
    creditedAt: nn(r.credited_at),
  }
}

export function mapWithdrawal(r: Record<string, unknown>): WithdrawalRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    mode: r.mode as WithdrawalRow['mode'],
    amountMicros: b(r.amount_micros),
    feeMicros: b(r.fee_micros),
    netMicros: b(r.net_micros),
    destinationAccountId: r.destination_account_id as string | null,
    destinationIban: r.destination_iban as string | null,
    status: r.status as WithdrawalRow['status'],
    idempotencyKey: String(r.idempotency_key),
    scamRef: r.scam_ref as string | null,
    scamTxId: nn(r.scam_tx_id),
    error: r.error as string | null,
    requestedAt: n(r.requested_at),
    sentAt: nn(r.sent_at),
  }
}

export function mapJob(r: Record<string, unknown>): JobRow {
  return {
    id: String(r.id),
    type: String(r.type),
    priority: n(r.priority),
    payload: String(r.payload),
    dedupeKey: r.dedupe_key as string | null,
    status: r.status as JobRow['status'],
    runAt: n(r.run_at),
    attempts: n(r.attempts),
    maxAttempts: n(r.max_attempts),
    lockedAt: nn(r.locked_at),
    lastError: r.last_error as string | null,
    createdAt: n(r.created_at),
    finishedAt: nn(r.finished_at),
  }
}

export function mapNotification(r: Record<string, unknown>): NotificationRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    kind: String(r.kind),
    payload: String(r.payload),
    readAt: nn(r.read_at),
    createdAt: n(r.created_at),
  }
}

export function mapTrigger(r: Record<string, unknown>): TriggerRow {
  return {
    id: String(r.id),
    positionId: String(r.position_id),
    kind: r.kind as 'tp' | 'sl',
    triggerPrice: String(r.trigger_price),
    status: r.status as TriggerRow['status'],
    createdAt: n(r.created_at),
  }
}

export function mapMarginEvent(r: Record<string, unknown>): MarginEventRow {
  return {
    id: String(r.id),
    positionId: String(r.position_id),
    deltaMicros: b(r.delta_micros),
    reason: String(r.reason),
    createdAt: n(r.created_at),
  }
}

export function mapLiquidation(r: Record<string, unknown>): LiquidationRow {
  return {
    id: String(r.id),
    positionId: String(r.position_id),
    userId: String(r.user_id),
    markPrice: String(r.mark_price),
    closePrice: String(r.close_price),
    equityMicros: b(r.equity_micros),
    deficitMicros: b(r.deficit_micros),
    penaltyMicros: b(r.penalty_micros),
    createdAt: n(r.created_at),
  }
}

export function mapPrice(r: Record<string, unknown>): PriceRow {
  return {
    symbol: String(r.symbol),
    bid: String(r.bid),
    ask: String(r.ask),
    mid: String(r.mid),
    quoteToUsd: String(r.quote_to_usd),
    marketState: r.market_state as PriceRow['marketState'],
    stale: n(r.stale) === 1,
    quoteAgeMs: n(r.quote_age_ms),
    sourceTs: n(r.source_ts),
    updatedAt: n(r.updated_at),
  }
}

export function mapCandle(r: Record<string, unknown>): CandleRow {
  return {
    symbol: String(r.symbol),
    interval: String(r.interval),
    openTime: n(r.open_time),
    open: String(r.open),
    high: String(r.high),
    low: String(r.low),
    close: String(r.close),
    tickVolume: nn(r.tick_volume),
    isOpen: n(r.is_open) === 1,
    fetchedAt: n(r.fetched_at),
  }
}
