import { z } from 'zod'
import { CANDLE_INTERVALS } from '@fx42/shared'

export const modeSchema = z.enum(['real', 'virtual'])
export type Mode = z.infer<typeof modeSchema>

export const sideSchema = z.enum(['long', 'short'])
export type Side = z.infer<typeof sideSchema>

const decimalString = z.preprocess(
  // UI number inputs and permissive API clients may send JSON numbers; the
  // public contract remains decimal strings, so normalize before validating.
  (value) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : value),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal string')
    .max(40),
)

export const positiveDecimal = decimalString.refine((v) => Number(v) > 0, 'Must be positive')
export const nonNegativeDecimal = decimalString.refine((v) => Number(v) >= 0, 'Must be >= 0')

const requestId = z.string().min(8).max(128)

export const onboardingAcceptSchema = z.object({
  mode: modeSchema,
})
export type OnboardingAcceptInput = z.infer<typeof onboardingAcceptSchema>

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  locale: z.enum(['zh-CN', 'en']).optional(),
  defaultMode: modeSchema.optional(),
})
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>

export const bindTokenSchema = z.object({
  token: z.string().trim().min(16).max(256).regex(/^\S+$/, 'Token must not contain whitespace'),
})
export type BindTokenInput = z.infer<typeof bindTokenSchema>

export const setPrimaryAccountSchema = z.object({
  accountId: z.string().min(1),
})

export const autoDepositSchema = z.object({
  amount: positiveDecimal,
  accountId: z.string().min(1),
  requestId,
})
export type AutoDepositInput = z.infer<typeof autoDepositSchema>

export const virtualDepositSchema = z.object({
  amount: positiveDecimal,
  requestId,
})
export type VirtualDepositInput = z.infer<typeof virtualDepositSchema>

export const withdrawalSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('real'),
    amount: positiveDecimal,
    destinationAccountId: z.string().min(1),
    requestId,
  }),
  z.object({
    mode: z.literal('virtual'),
    amount: positiveDecimal,
    requestId,
  }),
])
export type WithdrawalInput = z.infer<typeof withdrawalSchema>

export const orderSchema = z
  .object({
    mode: modeSchema,
    symbol: z.string().min(3).max(32),
    side: sideSchema,
    lots: positiveDecimal.optional(),
    units: positiveDecimal.optional(),
    leverage: z.number().int().min(1).max(1000),
    type: z.literal('market').default('market'),
    clientOrderId: z.string().min(8).max(128),
    takeProfit: positiveDecimal.optional(),
    stopLoss: positiveDecimal.optional(),
    confirmStale: z.boolean().optional().default(false),
  })
  .refine((v) => (v.lots === undefined) !== (v.units === undefined), {
    message: 'Provide exactly one of lots or units',
  })
export type PlaceOrderInput = z.infer<typeof orderSchema>

export const orderPreviewSchema = z.object({
  mode: modeSchema,
  symbol: z.string().min(3).max(32),
  side: sideSchema,
  lots: positiveDecimal.optional(),
  units: positiveDecimal.optional(),
  leverage: z.number().int().min(1).max(1000),
})
export type OrderPreviewInput = z.infer<typeof orderPreviewSchema>

export const closePositionSchema = z.object({
  units: positiveDecimal.optional(),
  confirmStale: z.boolean().optional().default(false),
  clientOrderId: z.string().min(8).max(128).optional(),
})
export type ClosePositionInput = z.infer<typeof closePositionSchema>

export const positionMarginSchema = z.object({
  action: z.enum(['add', 'remove']),
  amount: positiveDecimal,
})
export type PositionMarginInput = z.infer<typeof positionMarginSchema>

export const tpslSchema = z
  .object({
    takeProfit: positiveDecimal.nullable().optional(),
    stopLoss: positiveDecimal.nullable().optional(),
  })
  .refine((v) => v.takeProfit !== undefined || v.stopLoss !== undefined, {
    message: 'Provide takeProfit and/or stopLoss',
  })
export type TpSlInput = z.infer<typeof tpslSchema>

export const autoCloseSchema = z.object({
  autoCloseRatio: nonNegativeDecimal.nullable(),
})
export type AutoCloseInput = z.infer<typeof autoCloseSchema>

export const closeAllSchema = z.object({
  mode: modeSchema,
  allowStale: z.boolean().optional().default(false),
})

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
})

export const candlesQuerySchema = z.object({
  interval: z.enum(CANDLE_INTERVALS).default('1h'),
  limit: z.coerce.number().int().min(10).max(1000).default(300),
})

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    requestId?: string
  }
}

export type ProviderDto = {
  id: string
  displayName: string
  kind: 'dn42' | 'generic'
}

export type AccountDto = {
  id: string
  mode: Mode
  currency: 'FTK' | 'VFTK'
  status: 'active' | 'closed'
}

export type IdentityDto = {
  providerId: string
  providerKind: 'dn42' | 'generic'
  activeMnt: string | null
}

export type UserMeDto = {
  user: {
    id: string
    identityId: string
    providerId: string
    providerKind: 'dn42' | 'generic'
    sub: string
    activeMnt: string | null
    identities: IdentityDto[]
    displayName: string | null
    status: 'active' | 'suspended' | 'closed'
    hasScamToken: boolean
    locale: 'zh-CN' | 'en'
    termsAccepted: boolean
    defaultMode: Mode
    accounts: AccountDto[]
  }
}

export type WalletDto = {
  mode: Mode
  currency: 'FTK' | 'VFTK'
  balance: string
  equity: string
  marginUsed: string
  unrealizedPnl: string
  available: string
}

export type AccountSnapshotDto = {
  mode: Mode
  wallet: WalletDto | null
  positions: PositionDto[]
  serverTime: number
  sequence: number
}

export type ScamAccountDto = {
  id: string
  iban: string
  ibanFull?: string
  name: string | null
  isPrimary: boolean
  balance: string | null
}

export type MarketTickerDto = {
  symbol: string
  description: string
  base: string
  quote: string
  bid: string
  ask: string
  mid: string
  marketState: 'open' | 'closed'
  stale: boolean
  ftkUsdRate: string
  takerBps: number
  pricePrecision: number
  pipSize: string
  autoCloseRatioMin: string
  autoCloseRatioMax: string
  leverageTiers: number[]
  minNotionalFtk: string
  maxNotionalFtk: string
  contractSize: string
  minLots: string
  lotStep: string
  maxLots: string
  spreadPips: string
  spreadSpike: boolean
}

export type PositionDto = {
  id: string
  mode: Mode
  symbol: string
  side: Side
  units: string
  entryPrice: string
  markPrice: string
  contractSize: string
  minLots: string
  lotStep: string
  leverage: number
  margin: string
  unrealizedPnl: string
  realizedPnl: string
  liquidationPrice: string | null
  marginRatio: string
  autoCloseRatio: string | null
  takeProfit: string | null
  stopLoss: string | null
  openedAt: string
}

export type OrderDto = {
  id: string
  status: 'pending' | 'filled' | 'cancelled' | 'rejected' | 'expired'
  symbol: string
  side: Side
  units: string
  leverage: number
  reduceOnly: boolean
  filledPrice: string | null
  notionalFtk: string
  fee: string
  createdAt: string
}

export type PreviewAction = 'open' | 'increase' | 'reduce' | 'close' | 'flip'

export type PreviewDto = {
  symbol: string
  side: Side
  action: PreviewAction
  fillPrice: string
  units: string
  lots: string
  notionalFtk: string
  margin: string
  openFee: string
  closeFee: string
  liquidationPrice: string | null
  maxLoss: string
  realizedPnl: string | null
  existingUnits: string | null
  resultingUnits: string
  resultingEntryPrice: string | null
  resultingMargin: string
  resultingNotionalFtk: string
  effectiveMaxLots: string
}

export type DepositDto = {
  id: string
  mode: Mode
  method: 'transfer' | 'virtual'
  status: 'pending' | 'credited' | 'expired' | 'cancelled' | 'failed'
  amount: string
  receivedAmount?: string | null
  creditedAmount?: string | null
  fee?: string
  createdAt: string
}

export type WithdrawalDto = {
  id: string
  mode: Mode
  amount: string
  fee: string
  netAmount: string
  scamRef: string | null
  status: 'requested' | 'sending' | 'sent' | 'settled' | 'failed' | 'cancelled'
  destinationIban: string | null
  requestedAt: string
}

export type LedgerEntryDto = {
  amount: string
  balanceAfter: string
  createdAt: string
  type: string
  refType: string
  refId: string | null
  memo: string | null
}

export type FillDto = {
  id: string
  symbol: string
  side: Side
  action: string
  units: string
  price: string
  notional: string
  fee: string
  realizedPnl: string
  createdAt: string
}

export type DailyPnlDto = {
  date: string
  realizedPnl: string
  financing: string
  net: string
}

export type StatsOverviewDto = {
  notional24h: string
  openPositions: number
  liquidations24h: number
  reserveCoverageOk: boolean | null
  users: number
}

export * from './notifications'
