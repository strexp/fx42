import { z } from 'zod'
import type { InstrumentConfig } from '@fx42/domain'
import {
  parseSymbol,
  instrumentDirection,
  isSingleUsdInstrument,
  isUsdBaseInstrument,
  validateLeverageTiers,
} from '@fx42/domain'

const decimal = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Must be a non-negative decimal string')
  .max(40)

const positiveInt = z.number().int().positive()

export const providerSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  kind: z.enum(['dn42', 'generic']),
  displayName: z.string().min(1).max(64),
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecretEnv: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  // Claim field that carries the DN42 MNT. Read from the `dn42` claim object
  // first, then from the top level; dot paths (e.g. `dn42.mnt`) are allowed.
  mntClaim: z.string().trim().min(1).max(128).default('active_mnt'),
  enabled: z.boolean(),
})

export const instrumentSchema = z.object({
  symbol: z.string().min(6).max(24),
  enabled: z.boolean(),
  description: z.string().min(1),
  contractSize: decimal,
  pipSize: decimal,
  pricePrecision: z.number().int().min(0).max(9),
  minLots: decimal,
  lotStep: decimal,
  maxLots: decimal,
  maxNetExposureUsd: decimal,
})

export const configSchema = z
  .object({
    ftkUsdRate: decimal,
    leverageTiers: z.array(positiveInt).min(1),
    fees: z.object({
      takerBps: z.number().int().min(0).max(1000),
      minOpenFee: decimal,
      spreadMarkupBps: z.number().int().min(0).max(1000),
      depositBps: z.number().int().min(0).max(1000),
      withdrawFixed: decimal,
      withdrawBps: z.number().int().min(0).max(1000),
    }),
    risk: z.object({
      maintenanceMarginByLeverage: z.record(z.string(), z.number().int().positive()),
      gapBufferBps: z.number().int().min(0),
      liquidationFeeBps: z.number().int().min(0).max(10000),
      minOrderNotional: decimal,
      maxOrderNotional: decimal,
      maxUserNotional: decimal,
      maxPositionsPerUser: positiveInt,
      maxSlippageBps: z.number().int().min(0),
      staleQuoteMs: positiveInt,
      haltQuoteMs: positiveInt,
      priceJumpBps: z.number().int().min(0),
      staleClosePolicy: z.enum(['confirm', 'block']),
      maxStaleCloseFeedGapMs: positiveInt,
      cooldownAfterLiquidationSec: z.number().int().min(0),
      autoCloseRatioMin: decimal,
      autoCloseRatioMax: decimal,
      marketClosedPolicy: z.enum(['allow', 'close-only', 'block']),
    }),
    funding: z.object({
      memoExpiryMinutes: positiveInt,
      minDeposit: decimal,
      maxDeposit: decimal,
      maxDepositPerDay: decimal,
      minWithdraw: decimal,
      maxWithdraw: decimal,
      maxWithdrawPerDay: decimal,
      maxPendingDeposits: positiveInt,
    }),
    retention: z.object({
      candles1mDays: positiveInt,
      candles1hDays: positiveInt,
      notificationsDays: positiveInt,
    }),
    instruments: z.array(instrumentSchema),
    weekend: z.object({
      enabled: z.boolean(),
      startBeforeCloseMinutes: positiveInt,
      reduceBeforeCloseMinutes: positiveInt,
      maxLeverage: positiveInt,
      action: z.literal('margin-call-then-reduce'),
      reopenGraceMinutes: positiveInt,
    }),
    financing: z.object({
      enabled: z.boolean(),
      annualRateBps: z.number().int().min(0),
      basis: z.literal('notional'),
      settlementUtc: z.string().regex(/^\d{2}:\d{2}$/),
    }),
    virtual: z.object({
      maxDeposit: decimal,
      maxDailyDeposit: decimal,
    }),
    auth: z.object({
      providers: z.array(providerSchema),
    }),
    chart: z
      .object({
        mas: z.array(z.number().int().min(2).max(400)).default([5, 10, 20, 60]),
      })
      .default({ mas: [5, 10, 20, 60] }),
  })
  .superRefine((cfg, ctx) => {
    const tiers = new Set(cfg.leverageTiers)
    if (tiers.size !== cfg.leverageTiers.length) {
      ctx.addIssue({ code: 'custom', message: 'leverageTiers contains duplicates' })
    }
    for (const t of cfg.leverageTiers) {
      if (!cfg.risk.maintenanceMarginByLeverage[String(t)]) {
        ctx.addIssue({ code: 'custom', message: `missing MMR for leverage ${t}` })
      }
    }
    const ids = new Set<string>()
    for (const p of cfg.auth.providers) {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `duplicate provider id ${p.id}` })
      ids.add(p.id)
      if (p.kind === 'dn42' && !p.scopes.includes('dn42')) {
        ctx.addIssue({
          code: 'custom',
          message: `provider ${p.id} kind=dn42 must include dn42 scope`,
        })
      }
    }
    for (const inst of cfg.instruments) {
      if (!inst.enabled) continue
      const parsed = parseSymbol(inst.symbol)
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: `cannot parse symbol ${inst.symbol}` })
        continue
      }
      const direction = instrumentDirection(inst)!
      const withCurrencies: InstrumentConfig = {
        ...inst,
        base: direction.base,
        quote: direction.quote,
      }
      if (!isSingleUsdInstrument(withCurrencies)) {
        ctx.addIssue({
          code: 'custom',
          message: `v1 only supports quote=USD or base=USD instruments (${inst.symbol})`,
        })
      }
      if (isUsdBaseInstrument(inst) && inst.pricePrecision < 7) {
        ctx.addIssue({
          code: 'custom',
          message: `${inst.symbol}: base=USD instruments require pricePrecision >= 7`,
        })
      }
      const min = Number(inst.minLots)
      const step = Number(inst.lotStep)
      if (!(min > 0) || !(step > 0)) {
        ctx.addIssue({ code: 'custom', message: `${inst.symbol}: lots must be positive` })
      }
    }
    const enabledPairs = cfg.instruments.filter((i) => i.enabled).map((i) => i.symbol)
    if (new Set(enabledPairs).size !== enabledPairs.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate enabled instrument symbol' })
    }
    const riskErrors = validateLeverageTiers(
      cfg.leverageTiers,
      Object.fromEntries(
        Object.entries(cfg.risk.maintenanceMarginByLeverage).map(([k, v]) => [Number(k), v]),
      ),
      cfg.fees.takerBps,
      cfg.risk.gapBufferBps,
    )
    for (const e of riskErrors) ctx.addIssue({ code: 'custom', message: e })
    if (cfg.risk.autoCloseRatioMin && cfg.risk.autoCloseRatioMax) {
      if (Number(cfg.risk.autoCloseRatioMin) > Number(cfg.risk.autoCloseRatioMax)) {
        ctx.addIssue({ code: 'custom', message: 'autoCloseRatioMin > autoCloseRatioMax' })
      }
    }
    if (Number(cfg.risk.minOrderNotional) > Number(cfg.risk.maxOrderNotional)) {
      ctx.addIssue({ code: 'custom', message: 'minOrderNotional > maxOrderNotional' })
    }
    if (Number(cfg.risk.maxOrderNotional) > Number(cfg.risk.maxUserNotional)) {
      ctx.addIssue({ code: 'custom', message: 'maxOrderNotional > maxUserNotional' })
    }
  })

export type Fx42Config = z.infer<typeof configSchema>
export type ProviderConfig = Fx42Config['auth']['providers'][number]
export type InstrumentYaml = Fx42Config['instruments'][number]

export type Instrument = InstrumentConfig & {
  enabled: boolean
}

export function instrumentsFromConfig(cfg: Fx42Config): Map<string, Instrument> {
  const map = new Map<string, Instrument>()
  for (const raw of cfg.instruments) {
    const parsed = parseSymbol(raw.symbol)
    if (!parsed) continue
    const direction = instrumentDirection(raw)!
    map.set(raw.symbol, { ...raw, base: direction.base, quote: direction.quote })
  }
  return map
}

export function maintenanceRatioFor(cfg: Fx42Config, leverage: number): number {
  const mmr = cfg.risk.maintenanceMarginByLeverage[String(leverage)]
  if (mmr === undefined) throw new Error(`No maintenance margin configured for ${leverage}x`)
  return mmr
}

export function riskFingerprint(cfg: Fx42Config): Record<string, unknown> {
  return {
    ftkUsdRate: cfg.ftkUsdRate,
    leverageTiers: cfg.leverageTiers,
    maintenanceMarginByLeverage: cfg.risk.maintenanceMarginByLeverage,
    takerBps: cfg.fees.takerBps,
    weekendMaxLeverage: cfg.weekend.maxLeverage,
    financing: cfg.financing,
    liquidationFeeBps: cfg.risk.liquidationFeeBps,
  }
}

export function riskFingerprintChanged(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
): boolean {
  if (!prev) return false
  return stableStringify(prev) !== stableStringify(next)
}

export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const normalize = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v as object)) return '[circular]'
    seen.add(v as object)
    if (Array.isArray(v)) return v.map(normalize)
    const obj = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) out[key] = normalize(obj[key])
    return out
  }
  return JSON.stringify(normalize(value))
}

export function normaliseMnt(value: string): string {
  return value.trim().toUpperCase()
}
