import Decimal from 'decimal.js'
import { AppError, dec, toMicros } from '@fx42/shared'
import {
  AUTO_CLOSE_SAFETY_RATIO,
  autoCloseRatioToBps,
  maintenanceMargin,
  marginFor,
  notionalFtk,
  positionEquity,
  positionMetrics,
  unrealizedPnl,
  validateTpSl,
  weekendMinMargin,
} from '@fx42/domain'
import {
  getAccount,
  getUser,
  instrumentFor,
  isWeekendWindow,
  priceFor,
  quoteToUsd,
  ftkUsdRate,
} from './../helpers'
import type { TradingContext, PriceSnapshot } from './../ports'
import type { PositionRow } from '@fx42/db'
import { closePosition } from './close'
import { liquidationPriceFor } from './orders'
import { M } from './shared'

export function addRemoveMargin(
  ctx: TradingContext,
  userId: string,
  positionId: string,
  input: { action: 'add' | 'remove'; amount: string },
): PositionRow {
  const pos = ctx.repos.trading.findPositionById(positionId)
  if (!pos || pos.userId !== userId) throw new AppError('POSITION_NOT_FOUND')
  if (pos.status !== 'open') throw new AppError('POSITION_CLOSED')
  const user = getUser(ctx, userId)
  if (user.status === 'closed') throw new AppError('USER_SUSPENDED')
  const account = ctx.repos.users.findAccountById(pos.accountId)!
  const amount = dec(input.amount)
  const amountMicros = toMicros(amount, 'ceil')
  if (amountMicros <= 0n) throw new AppError('VALIDATION_ERROR')
  const now = ctx.clock.now()
  return ctx.uow.run((repos) => {
    const fresh = repos.trading.findPositionById(positionId)!
    if (fresh.status !== 'open') throw new AppError('POSITION_CLOSED')
    const wallet = repos.wallets.findUserWallet(account.id)!
    if (input.action === 'add') {
      if (wallet.balanceMicros < amountMicros) throw new AppError('INSUFFICIENT_BALANCE')
      repos.wallets.postLedger({
        mode: account.mode,
        type: 'margin_lock',
        refType: 'position',
        refId: fresh.id,
        memo: 'add position margin',
        entries: [
          { walletId: wallet.id, amountMicros: -amountMicros },
          { walletId: `sys:${account.mode}:margin_pool`, amountMicros },
        ],
        now,
      })
      const updated = repos.trading.updatePosition(fresh.id, {
        marginMicros: fresh.marginMicros + amountMicros,
        version: fresh.version,
      })
      repos.trading.createMarginEvent(fresh.id, amountMicros, 'add', now)
      return updated
    }
    const price = priceFor(ctx, fresh.symbol)
    const instrument = instrumentFor(ctx, fresh.symbol)
    const mark = dec(price.mid)
    const q2u = quoteToUsd(ctx, instrument, mark)
    const notional = notionalFtk(M(fresh.unitsMicros), mark, q2u, ftkUsdRate(ctx))
    const initialMargin = marginFor(notional, fresh.leverage)
    const pnl = unrealizedPnl(
      {
        side: fresh.side,
        units: M(fresh.unitsMicros),
        entryPrice: dec(fresh.entryPrice),
        margin: '0',
        maintenanceRatioBps: fresh.maintenanceRatioBps,
      },
      mark,
      q2u,
      ftkUsdRate(ctx),
    )
    const newMargin = M(fresh.marginMicros).minus(amount)
    if (newMargin.lt(initialMargin))
      throw new AppError('MARGIN_REQUIRED', { message: 'below initial margin' })
    const equity = positionEquity(newMargin, pnl)
    const maintenance = maintenanceMargin(notional, fresh.maintenanceRatioBps)
    if (equity.lt(maintenance.mul('1.5')))
      throw new AppError('MARGIN_REQUIRED', { message: 'insufficient buffer' })
    if (isWeekendWindow(ctx.config, now)) {
      const weekendMin = weekendMinMargin(notional, ctx.config.weekend.maxLeverage)
      if (newMargin.lt(weekendMin)) throw new AppError('WEEKEND_MARGIN')
    }
    repos.wallets.postLedger({
      mode: account.mode,
      type: 'margin_release',
      refType: 'position',
      refId: fresh.id,
      memo: 'remove position margin',
      entries: [
        { walletId: `sys:${account.mode}:margin_pool`, amountMicros: -amountMicros },
        { walletId: wallet.id, amountMicros },
      ],
      now,
    })
    const updated = repos.trading.updatePosition(fresh.id, {
      marginMicros: fresh.marginMicros - amountMicros,
      version: fresh.version,
    })
    repos.trading.createMarginEvent(fresh.id, -amountMicros, 'remove', now)
    return updated
  })
}

export function setTpSl(
  ctx: TradingContext,
  userId: string,
  positionId: string,
  input: { takeProfit?: string | null; stopLoss?: string | null },
): PositionRow {
  const pos = ctx.repos.trading.findPositionById(positionId)
  if (!pos || pos.userId !== userId) throw new AppError('POSITION_NOT_FOUND')
  if (pos.status !== 'open') throw new AppError('POSITION_CLOSED')
  const tp = input.takeProfit === null ? null : input.takeProfit
  const sl = input.stopLoss === null ? null : input.stopLoss
  if (!validateTpSl(pos.side, dec(pos.entryPrice), tp ? dec(tp) : null, sl ? dec(sl) : null)) {
    throw new AppError('INVALID_TP_SL')
  }
  return ctx.uow.run((repos) => {
    if (tp !== undefined) {
      if (tp === null) {
        const active = repos.trading.listActiveTriggers(pos.id).filter((t) => t.kind === 'tp')
        for (const t of active) repos.trading.markTrigger(t.id, 'cancelled')
      } else repos.trading.upsertTrigger(pos.id, 'tp', tp, ctx.clock.now())
    }
    if (sl !== undefined) {
      if (sl === null) {
        const active = repos.trading.listActiveTriggers(pos.id).filter((t) => t.kind === 'sl')
        for (const t of active) repos.trading.markTrigger(t.id, 'cancelled')
      } else repos.trading.upsertTrigger(pos.id, 'sl', sl, ctx.clock.now())
    }
    return repos.trading.findPositionById(pos.id)!
  })
}

export function setAutoClose(
  ctx: TradingContext,
  userId: string,
  positionId: string,
  input: { autoCloseRatio: string | null },
): PositionRow {
  const pos = ctx.repos.trading.findPositionById(positionId)
  if (!pos || pos.userId !== userId) throw new AppError('POSITION_NOT_FOUND')
  if (pos.status !== 'open') throw new AppError('POSITION_CLOSED')
  let bps: number | null = null
  if (input.autoCloseRatio !== null && input.autoCloseRatio !== '0') {
    const ratio = dec(input.autoCloseRatio)
    const currentRatio = riskRatio(ctx, pos, priceFor(ctx, pos.symbol))
    const configMax = dec(ctx.config.risk.autoCloseRatioMax)
    // Keep the auto-close line at most 90% of the current margin ratio;
    // otherwise the next 250ms risk scan could close the position instantly.
    const maxAllowed = Decimal.min(configMax, currentRatio.mul(AUTO_CLOSE_SAFETY_RATIO))
    if (ratio.lt(dec(ctx.config.risk.autoCloseRatioMin)) || ratio.gt(maxAllowed)) {
      throw new AppError('VALIDATION_ERROR', {
        details: {
          min: ctx.config.risk.autoCloseRatioMin,
          max: maxAllowed.toFixed(2),
          configMax: ctx.config.risk.autoCloseRatioMax,
          currentRatio: currentRatio.toFixed(4),
        },
      })
    }
    bps = autoCloseRatioToBps(ratio)
  }
  return ctx.repos.trading.updatePosition(pos.id, { autoCloseRatioBps: bps, version: pos.version })
}

export function closeAll(
  ctx: TradingContext,
  userId: string,
  mode: 'real' | 'virtual',
  options: { allowStale: boolean },
): {
  closed: Array<{ positionId: string; symbol: string; closePrice: string; staleFill: boolean }>
  failed: Array<{ positionId: string; code: string }>
} {
  const account = getAccount(ctx, userId, mode)
  const positions = ctx.repos.trading.listOpenPositionsByAccount(account.id)
  const closed: Array<{
    positionId: string
    symbol: string
    closePrice: string
    staleFill: boolean
  }> = []
  const failed: Array<{ positionId: string; code: string }> = []
  const sorted = [...positions].sort((a, b) => {
    const pa = ctx.prices.get(a.symbol)
    const pb = ctx.prices.get(b.symbol)
    const ra = pa ? riskRatio(ctx, a, pa) : new Decimal(0)
    const rb = pb ? riskRatio(ctx, b, pb) : new Decimal(0)
    return ra.comparedTo(rb)
  })
  for (const pos of sorted) {
    try {
      const price = ctx.prices.get(pos.symbol)
      const stale = !price || price.stale || price.marketState === 'closed'
      if (stale && !options.allowStale) {
        failed.push({ positionId: pos.id, code: 'MARKET_CLOSED' })
        continue
      }
      const result = closePosition(ctx, userId, pos.id, {
        reason: 'manual',
        confirmStale: stale && options.allowStale,
        clientOrderId: `close-all:${pos.id}:${ctx.clock.now()}`,
      })
      closed.push({
        positionId: pos.id,
        symbol: pos.symbol,
        closePrice: result.closePrice,
        staleFill: stale,
      })
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL'
      failed.push({ positionId: pos.id, code })
    }
  }
  return { closed, failed }
}

export function riskRatio(ctx: TradingContext, pos: PositionRow, price: PriceSnapshot): Decimal {
  const instrument = instrumentFor(ctx, pos.symbol)
  return positionMetrics(
    {
      side: pos.side,
      units: M(pos.unitsMicros),
      entryPrice: dec(pos.entryPrice),
      margin: M(pos.marginMicros),
      maintenanceRatioBps: pos.maintenanceRatioBps,
    },
    dec(price.mid),
    instrument,
    ftkUsdRate(ctx),
  ).marginRatio
}

export function liquidationForPosition(ctx: TradingContext, pos: PositionRow): string | null {
  const instrument = instrumentFor(ctx, pos.symbol)
  return liquidationPriceFor(ctx, instrument, {
    side: pos.side,
    entry: dec(pos.entryPrice),
    units: M(pos.unitsMicros),
    margin: M(pos.marginMicros),
    maintenanceRatioBps: pos.maintenanceRatioBps,
  })
}
