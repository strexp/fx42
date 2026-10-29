export type Mode = 'real' | 'virtual'
export type Side = 'long' | 'short'
export type UserStatus = 'active' | 'suspended' | 'closed'

export interface UserRow {
  id: string
  activeMnt: string | null
  displayName: string | null
  email: string | null
  locale: 'zh-CN' | 'en'
  status: UserStatus
  sessionVersion: number
  defaultMode: Mode
  onboardingCompletedAt: number | null
  lastLoginAt: number | null
  createdAt: number
}

export interface IdentityRow {
  id: string
  userId: string
  providerId: string
  providerKind: 'dn42' | 'generic'
  subject: string
  activeMnt: string | null
  email: string | null
  createdAt: number
  lastLoginAt: number | null
}

export interface AccountRow {
  id: string
  userId: string
  mode: Mode
  currency: 'FTK' | 'VFTK'
  status: 'active' | 'closed'
  createdAt: number
}

export interface WalletRow {
  id: string
  accountId: string | null
  mode: Mode
  kind: string
  balanceMicros: bigint
  allowNegative: boolean
  updatedAt: number
}

export interface CredentialRow {
  id: string
  userId: string
  tokenCipher: string
  keyVersion: number
  tokenHint: string
  scamUserId: number | null
  scamUsername: string | null
  status: 'active' | 'invalid' | 'unverified' | 'revoked'
  verifiedAt: number | null
  lastUsedAt: number | null
  revokedAt: number | null
  createdAt: number
}

export interface ScamAccountRow {
  id: string
  credentialId: string
  scamAccountId: number
  iban: string
  accountName: string | null
  balanceSnapshotMicros: bigint | null
  isPrimary: boolean
  syncedAt: number | null
}

export interface OrderRow {
  id: string
  userId: string
  accountId: string
  symbol: string
  side: Side
  type: 'market' | 'limit' | 'stop'
  reduceOnly: boolean
  unitsMicros: bigint
  leverage: number
  limitPrice: string | null
  stopPrice: string | null
  status: 'pending' | 'filled' | 'cancelled' | 'rejected' | 'expired'
  clientOrderId: string
  filledPrice: string | null
  notionalMicros: bigint
  feeMicros: bigint
  filledAt: number | null
  rejectReason: string | null
  positionId: string | null
  expiresAt: number | null
  createdAt: number
}

export interface PositionRow {
  id: string
  userId: string
  accountId: string
  symbol: string
  side: Side
  unitsMicros: bigint
  entryPrice: string
  leverage: number
  maintenanceRatioBps: number
  marginMicros: bigint
  lastFinancingAt: number | null
  autoCloseRatioBps: number | null
  openFeeMicros: bigint
  realizedPnlMicros: bigint
  status: 'open' | 'closed' | 'liquidated'
  closePrice: string | null
  closeReason: string | null
  openedAt: number
  closedAt: number | null
  version: number
}

export interface FillRow {
  id: string
  orderId: string
  userId: string
  accountId: string
  positionId: string | null
  symbol: string
  side: Side
  action: string
  unitsMicros: bigint
  price: string
  notionalMicros: bigint
  feeMicros: bigint
  realizedPnlMicros: bigint
  createdAt: number
}

export interface DepositRow {
  id: string
  userId: string
  accountId: string
  mode: Mode
  method: 'transfer' | 'virtual'
  scamTxId: number | null
  amountMicros: bigint
  receivedMicros: bigint | null
  feeMicros: bigint
  creditedMicros: bigint | null
  requestId: string | null
  status: 'pending' | 'credited' | 'expired' | 'cancelled' | 'failed'
  memoCode: string | null
  expiresAt: number | null
  raw: string | null
  createdAt: number
  creditedAt: number | null
}

export interface WithdrawalRow {
  id: string
  userId: string
  accountId: string
  mode: Mode
  amountMicros: bigint
  feeMicros: bigint
  netMicros: bigint
  destinationAccountId: string | null
  destinationIban: string | null
  status: 'requested' | 'sending' | 'sent' | 'settled' | 'failed' | 'cancelled'
  idempotencyKey: string
  scamRef: string | null
  scamTxId: number | null
  error: string | null
  requestedAt: number
  sentAt: number | null
}

export interface JobRow {
  id: string
  type: string
  priority: number
  payload: string
  dedupeKey: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  runAt: number
  attempts: number
  maxAttempts: number
  lockedAt: number | null
  lastError: string | null
  createdAt: number
  finishedAt: number | null
}

export interface NotificationRow {
  id: string
  userId: string
  kind: string
  payload: string
  readAt: number | null
  createdAt: number
}

export interface TriggerRow {
  id: string
  positionId: string
  kind: 'tp' | 'sl'
  triggerPrice: string
  status: 'active' | 'triggered' | 'cancelled'
  createdAt: number
}

export interface MarginEventRow {
  id: string
  positionId: string
  deltaMicros: bigint
  reason: string
  createdAt: number
}

export interface LiquidationRow {
  id: string
  positionId: string
  userId: string
  markPrice: string
  closePrice: string
  equityMicros: bigint
  deficitMicros: bigint
  penaltyMicros: bigint
  createdAt: number
}

export interface PriceRow {
  symbol: string
  bid: string
  ask: string
  mid: string
  quoteToUsd: string
  marketState: 'open' | 'closed'
  stale: boolean
  quoteAgeMs: number
  sourceTs: number
  updatedAt: number
}

export interface CandleRow {
  symbol: string
  interval: string
  openTime: number
  open: string
  high: string
  low: string
  close: string
  tickVolume: number | null
  isOpen: boolean
  fetchedAt: number
}
