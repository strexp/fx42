import { fromMicros } from '@fx42/shared'
import { positionSummary, type AppContext, type PreviewResult } from '@fx42/application'
import type {
  AccountDto,
  AccountSnapshotDto,
  DepositDto,
  MarketTickerDto,
  OrderDto,
  PositionDto,
  PreviewDto,
  ScamAccountDto,
  UserMeDto,
  WalletDto,
  WithdrawalDto,
} from '@fx42/contracts'
import type {
  AccountRow,
  DepositRow,
  OrderRow,
  PositionRow,
  ScamAccountRow,
  UserRow,
  WithdrawalRow,
} from '@fx42/db'
import Decimal from 'decimal.js'
import { instrumentDirection } from '@fx42/domain'
import { ftkPipsForSymbol, ftkPrice, ftkPriceForSymbol, ftkPriceNullable } from './market'

export function accountDto(a: AccountRow): AccountDto {
  return { id: a.id, mode: a.mode, currency: a.currency, status: a.status }
}

function accountWallet(
  ctx: AppContext,
  userId: string,
  mode: 'real' | 'virtual',
): { wallet: WalletDto | null; positions: PositionDto[] } {
  const account = ctx.repos.users.findAccountByUserMode(userId, mode)
  if (!account) return { wallet: null, positions: [] }
  const walletRow = ctx.repos.wallets.findUserWallet(account.id)
  const balance = walletRow?.balanceMicros ?? 0n
  let margin = 0n
  let pnl = new Decimal(0)
  const positions = ctx.repos.trading.listOpenPositionsByAccount(account.id).map((pos) => {
    const summary = positionSummary(ctx, pos)
    margin += pos.marginMicros
    pnl = pnl.plus(summary.unrealizedPnl)
    return positionDtoFromSummary(ctx, pos, summary)
  })
  const equity = new Decimal(fromMicros(balance)).plus(fromMicros(margin)).plus(pnl)
  return {
    wallet: {
      mode,
      currency: mode === 'real' ? 'FTK' : 'VFTK',
      balance: fromMicros(balance),
      equity: equity.toFixed(8),
      marginUsed: fromMicros(margin),
      unrealizedPnl: pnl.toFixed(8),
      available: fromMicros(balance),
    },
    positions,
  }
}

export function walletDto(ctx: AppContext, userId: string, mode: 'real' | 'virtual'): WalletDto {
  const { wallet } = accountWallet(ctx, userId, mode)
  if (!wallet) throw new Error('account missing')
  return wallet
}

export function meDto(
  ctx: AppContext,
  userId: string,
  session: { identityId: string; providerId: string },
): UserMeDto {
  const user = ctx.repos.users.findUserById(userId)!
  const identity = ctx.repos.users.findIdentityById(session.identityId)
  const identities = ctx.repos.users.listIdentitiesByUser(userId).map((i) => ({
    providerId: i.providerId,
    providerKind: i.providerKind,
    activeMnt: i.activeMnt,
  }))
  return {
    user: {
      id: user.id,
      identityId: session.identityId,
      providerId: session.providerId,
      providerKind: identity?.providerKind ?? 'generic',
      sub: identity?.subject ?? '',
      activeMnt: user.activeMnt,
      identities,
      displayName: user.displayName,
      status: user.status,
      hasScamToken: !!ctx.repos.credentials.findActiveCredential(userId),
      locale: user.locale,
      termsAccepted: !!ctx.repos.users.findTerms(userId),
      defaultMode: user.defaultMode,
      accounts: ctx.repos.users.findAccountsByUser(userId).map(accountDto),
    },
  }
}

export function orderDto(ctx: AppContext, order: OrderRow): OrderDto {
  return {
    id: order.id,
    status: order.status,
    symbol: order.symbol,
    side: order.side,
    units: fromMicros(order.unitsMicros),
    leverage: order.leverage,
    reduceOnly: order.reduceOnly,
    filledPrice: ftkPriceNullable(ctx, order.symbol, order.filledPrice),
    notionalFtk: fromMicros(order.notionalMicros),
    fee: fromMicros(order.feeMicros),
    createdAt: new Date(order.createdAt).toISOString(),
  }
}

function positionDtoFromSummary(
  ctx: AppContext,
  pos: PositionRow,
  summary: ReturnType<typeof positionSummary>,
): PositionDto {
  const account = ctx.repos.users.findAccountById(pos.accountId)
  const instrument = ctx.config.instruments.find((i) => i.symbol === pos.symbol)
  const triggers = ctx.repos.trading.listActiveTriggers(pos.id)
  return {
    id: pos.id,
    mode: account?.mode ?? 'virtual',
    symbol: pos.symbol,
    side: pos.side,
    units: fromMicros(pos.unitsMicros),
    entryPrice: ftkPriceForSymbol(ctx, pos.symbol, pos.entryPrice),
    markPrice: ftkPriceForSymbol(ctx, pos.symbol, summary.markPrice),
    contractSize: instrument?.contractSize ?? '1',
    minLots: instrument?.minLots ?? '0',
    lotStep: instrument?.lotStep ?? '0',
    leverage: pos.leverage,
    margin: fromMicros(pos.marginMicros),
    unrealizedPnl: summary.unrealizedPnl,
    realizedPnl: fromMicros(pos.realizedPnlMicros),
    liquidationPrice: ftkPriceNullable(ctx, pos.symbol, summary.liquidationPrice),
    marginRatio: summary.marginRatio,
    autoCloseRatio: pos.autoCloseRatioBps ? (pos.autoCloseRatioBps / 10000).toFixed(2) : null,
    takeProfit: ftkPriceNullable(
      ctx,
      pos.symbol,
      triggers.find((t) => t.kind === 'tp')?.triggerPrice ?? null,
    ),
    stopLoss: ftkPriceNullable(
      ctx,
      pos.symbol,
      triggers.find((t) => t.kind === 'sl')?.triggerPrice ?? null,
    ),
    openedAt: new Date(pos.openedAt).toISOString(),
  }
}

export function positionDto(ctx: AppContext, pos: PositionRow): PositionDto {
  return positionDtoFromSummary(ctx, pos, positionSummary(ctx, pos))
}

let accountSnapshotSequence = 0

export function accountSnapshotDto(
  ctx: AppContext,
  userId: string,
  mode: 'real' | 'virtual',
): AccountSnapshotDto {
  const sequence = ++accountSnapshotSequence
  const serverTime = Date.now()
  const { wallet, positions } = accountWallet(ctx, userId, mode)
  return { mode, wallet, positions, serverTime, sequence }
}

export function previewDto(ctx: AppContext, preview: PreviewResult): PreviewDto {
  return {
    ...preview,
    fillPrice: ftkPriceForSymbol(ctx, preview.symbol, preview.fillPrice),
    liquidationPrice: ftkPriceNullable(ctx, preview.symbol, preview.liquidationPrice),
    resultingEntryPrice: ftkPriceNullable(ctx, preview.symbol, preview.resultingEntryPrice),
  }
}

export function maskIban(iban: string): string {
  return iban.length <= 12 ? iban : `${iban.slice(0, 10)}…${iban.slice(-4)}`
}

export function scamAccountDto(a: ScamAccountRow): ScamAccountDto {
  return {
    id: a.id,
    iban: maskIban(a.iban),
    ibanFull: a.iban,
    name: a.accountName,
    isPrimary: a.isPrimary,
    balance:
      a.balanceSnapshotMicros === null ? null : fromMicros(a.balanceSnapshotMicros, 4, false),
  }
}

export function depositDto(d: DepositRow): DepositDto {
  return {
    id: d.id,
    mode: d.mode,
    method: d.method,
    status: d.status,
    amount: fromMicros(d.amountMicros),
    receivedAmount: d.receivedMicros === null ? null : fromMicros(d.receivedMicros),
    creditedAmount: d.creditedMicros === null ? null : fromMicros(d.creditedMicros),
    fee: fromMicros(d.feeMicros),
    createdAt: new Date(d.createdAt).toISOString(),
  }
}

export function withdrawalDto(w: WithdrawalRow): WithdrawalDto {
  return {
    id: w.id,
    mode: w.mode,
    amount: fromMicros(w.amountMicros, 4),
    fee: fromMicros(w.feeMicros, 4),
    netAmount: fromMicros(w.netMicros, 4),
    scamRef: w.scamRef,
    status: w.status,
    destinationIban: w.destinationIban,
    requestedAt: new Date(w.requestedAt).toISOString(),
  }
}

export function marketTickerDto(ctx: AppContext, symbol: string): MarketTickerDto | null {
  const inst = ctx.config.instruments.find((i) => i.symbol === symbol && i.enabled)
  const price = ctx.prices.get(symbol)
  if (!inst || !price) return null
  const bid = ftkPrice(ctx, price.bid)
  const ask = ftkPrice(ctx, price.ask)
  const mid = ftkPrice(ctx, price.mid)
  const pipSize = ftkPipsForSymbol(ctx, symbol, price.mid)
  const spread = ask.minus(bid)
  const spreadPips = spread.div(pipSize).toDecimalPlaces(1).toString()
  return {
    symbol: inst.symbol,
    description: inst.description,
    base: instrumentDirection(inst)?.base ?? inst.symbol.slice(0, 3),
    quote: instrumentDirection(inst)?.quote ?? inst.symbol.slice(3, 6),
    bid: bid.toFixed(inst.pricePrecision),
    ask: ask.toFixed(inst.pricePrecision),
    mid: mid.toFixed(inst.pricePrecision),
    marketState: price.marketState,
    stale: price.stale,
    ftkUsdRate: ctx.config.ftkUsdRate,
    takerBps: ctx.config.fees.takerBps,
    pricePrecision: inst.pricePrecision,
    pipSize: pipSize,
    autoCloseRatioMin: ctx.config.risk.autoCloseRatioMin,
    autoCloseRatioMax: ctx.config.risk.autoCloseRatioMax,
    leverageTiers: ctx.config.leverageTiers,
    minNotionalFtk: ctx.config.risk.minOrderNotional,
    maxNotionalFtk: ctx.config.risk.maxOrderNotional,
    contractSize: inst.contractSize,
    minLots: inst.minLots,
    lotStep: inst.lotStep,
    maxLots: inst.maxLots,
    spreadPips,
    spreadSpike: price.spreadSpike,
  }
}

export function userSummary(ctx: AppContext, user: UserRow) {
  return {
    id: user.id,
    displayName: user.displayName,
    activeMnt: user.activeMnt,
    status: user.status,
    locale: user.locale,
  }
}
