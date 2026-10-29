import type { DbRepos } from '@fx42/db'
import type { Fx42Config } from '@fx42/config'
import type { Clock } from '@fx42/shared'

export type Repos = Pick<
  DbRepos,
  'users' | 'wallets' | 'credentials' | 'funding' | 'trading' | 'jobs' | 'runtime' | 'market' | 'db'
>

export interface UnitOfWork {
  run<T>(fn: (repos: Repos) => T): T
}

export interface LoggerPort {
  info: (o: unknown, m?: string) => void
  warn: (o: unknown, m?: string) => void
  error: (o: unknown, m?: string) => void
}

export interface ReserveMetricsPort {
  reserveCoverage: { set(value: number): void }
}

export interface PriceSnapshot {
  symbol: string
  bid: string
  ask: string
  mid: string
  quoteToUsd: string
  marketState: 'open' | 'closed'
  stale: boolean
  quoteAgeMs: number
  feedGapMs: number
  spreadSpike: boolean
  sourceTs: number
  updatedAt: number
}

export interface PricePort {
  get(symbol: string): PriceSnapshot | null
  all(): PriceSnapshot[]
  refreshAges?(now: number): void
}

export interface ScamAccountInfo {
  scamAccountId: number
  iban: string
  accountName: string | null
  balance: string
}

export interface ScamTransferResult {
  transactionId: number | null
  raw: unknown
}

export interface ScamPort {
  listAccounts(
    token: string,
  ): Promise<{ accounts: ScamAccountInfo[]; username: string | null; userId: number | null }>
  getAccount(token: string, accountId: number): Promise<ScamAccountInfo>
  transfer(
    token: string,
    input: {
      fromAccountId: number
      toIban: string
      amount: string
      description: string
      idempotencyKey: string
    },
  ): Promise<ScamTransferResult>
  listTransactions(
    token: string,
    input: { accountId: number; limit: number; minId?: number | null },
  ): Promise<{ transactions: ScamTransactionInfo[]; username: string | null }>
}

export interface ScamTransactionInfo {
  id: number
  fromAccount: string | null
  toAccount: string | null
  amount: string
  description: string | null
  type: string
  createdAt: number | null
}

export interface CryptoPort {
  encrypt(plain: string): { cipher: string; keyVersion: number }
  decrypt(cipher: string, keyVersion: number): string
  hint(plain: string): string
}

export class ScamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly definitive: boolean,
    readonly raw?: unknown,
  ) {
    super(message)
    this.name = 'ScamError'
  }
}

export interface ReserveAccountConfig {
  /** Operator-provided reserve account IBAN (SCAM_RESERVE_IBAN). */
  iban: string
  /** Operator-provided reserve account token (SCAM_RESERVE_TOKEN). */
  token: string
  /** Lazily resolved scam account id, cached per runtime. */
  scamAccountId: number | null
}

export interface AppContext {
  repos: Repos
  uow: UnitOfWork
  config: Fx42Config
  clock: Clock
  prices: PricePort
  scam: ScamPort
  crypto: CryptoPort
  reserve: ReserveAccountConfig
}

export type RepoContext = Pick<AppContext, 'repos'>
export type ConfigContext = Pick<AppContext, 'config'>
export type PriceContext = Pick<AppContext, 'prices'>
export type AccountContext = Pick<AppContext, 'repos' | 'uow' | 'clock' | 'config'>
export type FundingContext = Pick<
  AppContext,
  'repos' | 'uow' | 'clock' | 'config' | 'scam' | 'crypto' | 'reserve'
>
export type ReconciliationContext = FundingContext & Pick<AppContext, 'prices'>
export type TradingContext = Pick<AppContext, 'repos' | 'uow' | 'clock' | 'config' | 'prices'>
export type MarketReadContext = Pick<AppContext, 'repos' | 'config' | 'prices'>
export type UserContext = Pick<AppContext, 'repos'>

export interface Actor {
  userId: string
  identityId: string | null
  ip: string | null
}
