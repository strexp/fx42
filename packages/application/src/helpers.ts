import Decimal from 'decimal.js'
import { AppError, dec, newYorkClock, toMicros } from '@fx42/shared'
import { normaliseMnt } from '@fx42/config'
import { instrumentDirection, quoteToUsdAt, type InstrumentConfig } from '@fx42/domain'
import type {
  AppContext,
  MarketReadContext,
  PriceContext,
  RepoContext,
  ConfigContext,
  PriceSnapshot,
  Repos,
} from './ports'
import type { AccountRow, PositionRow, UserRow } from '@fx42/db'

export function getAccount(ctx: RepoContext, userId: string, mode: 'real' | 'virtual'): AccountRow {
  const account = ctx.repos.users.findAccountByUserMode(userId, mode)
  if (!account || account.status !== 'active') {
    throw new AppError('ACCOUNT_INVALID', { details: { mode } })
  }
  return account
}

export function getUser(ctx: RepoContext, userId: string): UserRow {
  const user = ctx.repos.users.findUserById(userId)
  if (!user) throw new AppError('UNAUTHORIZED')
  return user
}

export function requireTerms(repos: Repos, userId: string): void {
  if (!repos.users.findTerms(userId)) throw new AppError('TERMS_REQUIRED')
}

export function requireOnboarding(repos: Repos, userId: string): void {
  const user = repos.users.findUserById(userId)
  if (!user) throw new AppError('UNAUTHORIZED')
  if (!user.onboardingCompletedAt) throw new AppError('ONBOARDING_REQUIRED')
}

export function instrumentFor(ctx: ConfigContext, symbol: string): InstrumentConfig {
  const inst = ctx.config.instruments.find((i) => i.symbol === symbol && i.enabled)
  if (!inst) throw new AppError('SYMBOL_DISABLED', { details: { symbol } })
  const direction = instrumentDirection(inst)
  if (!direction) throw new AppError('SYMBOL_DISABLED', { details: { symbol } })
  return { ...inst, ...direction }
}

export function priceFor(ctx: PriceContext, symbol: string): PriceSnapshot {
  const price = ctx.prices.get(symbol)
  if (!price) throw new AppError('MARKET_STALE', { details: { symbol } })
  return price
}

export function ftkUsdRate(ctx: ConfigContext): Decimal {
  return dec(ctx.config.ftkUsdRate)
}

export function quoteToUsd(
  _ctx: ConfigContext,
  instrument: InstrumentConfig,
  price: Decimal,
): Decimal {
  return quoteToUsdAt(instrument, price)
}

export function micros(value: Decimal, rounding: 'ceil' | 'half-up' | 'down' = 'ceil'): bigint {
  return toMicros(value, rounding)
}

export function availableBalance(ctx: RepoContext, accountId: string): bigint {
  const wallet = ctx.repos.wallets.findUserWallet(accountId)
  if (!wallet) throw new AppError('ACCOUNT_INVALID')
  return wallet.balanceMicros
}

export function isWeekendWindow(config: AppContext['config'], now: number): boolean {
  if (!config.weekend.enabled) return false
  const { weekday, minutes } = newYorkClock(now)
  const beforeClose = config.weekend.startBeforeCloseMinutes
  const closeHour = 17
  const start = closeHour * 60 - beforeClose
  const reopen = closeHour * 60 + config.weekend.reopenGraceMinutes
  if (weekday === 'Fri') return minutes >= start
  if (weekday === 'Sat') return true
  if (weekday === 'Sun') return minutes < reopen
  return false
}

export { utcDayStart } from '@fx42/shared'

export function positionNotionalFtk(
  ctx: MarketReadContext,
  pos: PositionRow,
  mark: Decimal,
): Decimal {
  const instrument = instrumentFor(ctx, pos.symbol)
  const q2u = quoteToUsd(ctx, instrument, mark)
  return dec(pos.unitsMicros).div(1e8).mul(mark).mul(q2u).div(ftkUsdRate(ctx))
}

export function accountOpenNotionalFtk(ctx: MarketReadContext, accountId: string): Decimal {
  let total = new Decimal(0)
  for (const pos of ctx.repos.trading.listOpenPositionsByAccount(accountId)) {
    const price = ctx.prices.get(pos.symbol)
    if (!price) continue
    total = total.plus(positionNotionalFtk(ctx, pos, dec(price.mid)))
  }
  return total
}

export function displayNameFor(claims: {
  name?: string
  preferredUsername?: string
  activeName?: string
  activeMnt?: string
  email?: string
}): string | null {
  return (
    claims.name ??
    claims.preferredUsername ??
    claims.activeName ??
    claims.activeMnt ??
    claims.email?.split('@')[0] ??
    null
  )
}

export { normaliseMnt }
