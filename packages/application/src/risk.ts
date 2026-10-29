import Decimal from 'decimal.js'
import { AppError, dec, fromMicros, newYorkClock, toMicros } from '@fx42/shared'
import {
  financingFee,
  notionalFtk,
  positionMetrics,
  RISK_RATIO_THRESHOLDS,
  weekendMinMargin,
} from '@fx42/domain'
import { ftkUsdRate, instrumentFor, isWeekendWindow, quoteToUsd, utcDayStart } from './helpers'
import { closePosition, liquidationForPosition, riskRatio } from './trading'
import type { TradingContext } from './ports'
import type { PositionRow } from '@fx42/db'

const M = (v: bigint) => dec(v).div(1e8)

export interface RiskAction {
  positionId: string
  kind: 'liquidation' | 'auto_close' | 'margin_call' | 'danger' | 'warning'
  ratio: string
  version: number
}

export function scanPositionRisks(ctx: TradingContext): RiskAction[] {
  const actions: RiskAction[] = []
  for (const pos of ctx.repos.trading.listOpenPositions()) {
    const price = ctx.prices.get(pos.symbol)
    if (!price || price.marketState === 'closed') continue
    const ratio = riskRatio(ctx, pos, price)
    if (!ratio.isFinite()) continue
    if (ratio.lte(1)) {
      actions.push({
        positionId: pos.id,
        kind: 'liquidation',
        ratio: ratio.toFixed(4),
        version: pos.version,
      })
      continue
    }
    if (pos.autoCloseRatioBps && ratio.lte(new Decimal(pos.autoCloseRatioBps).div(10000))) {
      actions.push({
        positionId: pos.id,
        kind: 'auto_close',
        ratio: ratio.toFixed(4),
        version: pos.version,
      })
      continue
    }
    if (ratio.lte(RISK_RATIO_THRESHOLDS.marginCall)) {
      actions.push({
        positionId: pos.id,
        kind: 'margin_call',
        ratio: ratio.toFixed(4),
        version: pos.version,
      })
    } else if (ratio.lte(RISK_RATIO_THRESHOLDS.danger)) {
      actions.push({
        positionId: pos.id,
        kind: 'danger',
        ratio: ratio.toFixed(4),
        version: pos.version,
      })
    } else if (ratio.lte(RISK_RATIO_THRESHOLDS.warning)) {
      actions.push({
        positionId: pos.id,
        kind: 'warning',
        ratio: ratio.toFixed(4),
        version: pos.version,
      })
    }
  }
  return actions
}

export function liquidatePosition(
  ctx: TradingContext,
  positionId: string,
  expectedVersion?: number,
): { liquidated: boolean; reason?: string; closePrice?: string } {
  const pos = ctx.repos.trading.findPositionById(positionId)
  if (!pos || pos.status !== 'open') return { liquidated: false, reason: 'not_open' }
  if (expectedVersion !== undefined && pos.version !== expectedVersion) {
    return { liquidated: false, reason: 'version_changed' }
  }
  const price = ctx.prices.get(pos.symbol)
  if (!price) return { liquidated: false, reason: 'stale' }
  if (price.marketState === 'closed') return { liquidated: false, reason: 'market_closed' }
  if (price.quoteAgeMs > ctx.config.risk.staleQuoteMs) return { liquidated: false, reason: 'stale' }
  const ratio = riskRatio(ctx, pos, price)
  if (ratio.gt(1)) return { liquidated: false, reason: 'recovered' }
  try {
    const result = closePosition(ctx, pos.userId, pos.id, {
      reason: 'liquidation',
      clientOrderId: `liq:${pos.id}:${pos.version}`,
    })
    ctx.repos.runtime.setFlag(
      `cooldown:${pos.userId}`,
      String(ctx.clock.now() + ctx.config.risk.cooldownAfterLiquidationSec * 1000),
      'liquidation cooldown',
      'risk',
      ctx.clock.now(),
    )
    return { liquidated: true, closePrice: result.closePrice }
  } catch (error) {
    if (error instanceof AppError) return { liquidated: false, reason: error.code }
    throw error
  }
}

export function autoClosePosition(
  ctx: TradingContext,
  positionId: string,
  expectedVersion?: number,
): boolean {
  const pos = ctx.repos.trading.findPositionById(positionId)
  if (!pos || pos.status !== 'open') return false
  if (expectedVersion !== undefined && pos.version !== expectedVersion) return false
  const price = ctx.prices.get(pos.symbol)
  if (!price || price.marketState === 'closed') return false
  const ratio = riskRatio(ctx, pos, price)
  if (ratio.lte(1)) return false // liquidation has priority
  if (!pos.autoCloseRatioBps || ratio.gt(new Decimal(pos.autoCloseRatioBps).div(10000)))
    return false
  closePosition(ctx, pos.userId, pos.id, {
    reason: 'auto',
    clientOrderId: `auto:${pos.id}:${pos.version}`,
  })
  return true
}

export function checkTriggers(
  ctx: TradingContext,
): Array<{ positionId: string; kind: 'tp' | 'sl' }> {
  const triggered: Array<{ positionId: string; kind: 'tp' | 'sl' }> = []
  for (const trigger of ctx.repos.trading.listAllActiveTriggers()) {
    const pos = ctx.repos.trading.findPositionById(trigger.positionId)
    if (!pos || pos.status !== 'open') continue
    const price = ctx.prices.get(pos.symbol)
    if (!price || price.marketState === 'closed') continue
    const mark = dec(price.mid)
    const target = dec(trigger.triggerPrice)
    const hit =
      trigger.kind === 'tp'
        ? pos.side === 'long'
          ? mark.gte(target)
          : mark.lte(target)
        : pos.side === 'long'
          ? mark.lte(target)
          : mark.gte(target)
    if (!hit) continue
    try {
      closePosition(ctx, pos.userId, pos.id, {
        reason: trigger.kind,
        clientOrderId: `${trigger.kind}:${pos.id}:${pos.version}`,
      })
      ctx.repos.trading.markTrigger(trigger.id, 'triggered')
      triggered.push({ positionId: pos.id, kind: trigger.kind })
    } catch {
      // another path (manual/liquidation) won; leave trigger state to that path
    }
  }
  return triggered
}

export function notifyRiskLevels(ctx: TradingContext, actions: RiskAction[]): void {
  const now = ctx.clock.now()
  for (const action of actions) {
    if (action.kind === 'liquidation' || action.kind === 'auto_close') continue
    const pos = ctx.repos.trading.findPositionById(action.positionId)
    if (!pos) continue
    if (ctx.repos.runtime.hasUnreadNotificationForPosition(pos.userId, pos.id, 'margin.')) continue
    const flagKey = `notify:${action.positionId}:${action.kind}`
    const last = ctx.repos.runtime.getFlag(flagKey)
    if (last && now - Number(last) < 5 * 60_000) continue
    ctx.repos.runtime.setFlag(flagKey, String(now), 'risk notification', 'risk', now)
    ctx.repos.runtime.addNotification(
      pos.userId,
      `margin.${action.kind}`,
      {
        positionId: pos.id,
        symbol: pos.symbol,
        ratio: action.ratio,
      },
      now,
    )
  }
}

export function applyFinancing(
  ctx: TradingContext,
  chargeDate: number,
): { charged: number; amountMicros: bigint } {
  if (!ctx.config.financing.enabled) return { charged: 0, amountMicros: 0n }
  let total = 0n
  let charged = 0
  const now = ctx.clock.now()
  for (const position of ctx.repos.trading.listOpenPositions()) {
    if (chargeDate < utcDayStart(position.openedAt)) continue
    const price = ctx.prices.get(position.symbol)
    if (!price) continue
    const instrument = instrumentFor(ctx, position.symbol)
    const mark = dec(price.mid)
    const q2u = quoteToUsd(ctx, instrument, mark)
    const notional = notionalFtk(M(position.unitsMicros), mark, q2u, ftkUsdRate(ctx))
    const fee = financingFee(notional, ctx.config.financing.annualRateBps)
    const feeMicros = toMicros(fee, 'ceil')
    if (feeMicros <= 0n) continue
    const mode = ctx.repos.users.findAccountById(position.accountId)?.mode
    if (!mode) continue
    const wallet = ctx.repos.wallets.findUserWallet(position.accountId)
    if (!wallet) continue
    const existing = ctx.repos.trading
      .listFinancingCharges(position.id)
      .find((c) => Number(c.charge_date) === chargeDate)
    if (existing) continue

    const fromBalance = wallet.balanceMicros >= feeMicros ? feeMicros : wallet.balanceMicros
    const remaining = feeMicros - fromBalance
    const fromMargin = remaining <= position.marginMicros ? remaining : position.marginMicros
    const taken = fromBalance + fromMargin
    if (taken <= 0n) {
      ctx.repos.runtime.addNotification(
        position.userId,
        'financing.unpaid',
        {
          positionId: position.id,
          symbol: position.symbol,
          amount: fromMicros(feeMicros),
        },
        now,
      )
      continue
    }
    const result = ctx.uow.run((repos) => {
      const fresh = repos.trading.findPositionById(position.id)
      if (!fresh || fresh.status !== 'open') return false
      const entries: Array<{ walletId: string; amountMicros: bigint }> = []
      if (fromBalance > 0n) entries.push({ walletId: wallet.id, amountMicros: -fromBalance })
      if (fromMargin > 0n)
        entries.push({ walletId: `sys:${mode}:margin_pool`, amountMicros: -fromMargin })
      entries.push({ walletId: `sys:${mode}:exchange_pnl`, amountMicros: taken })
      const txId = repos.wallets.postLedger({
        mode,
        type: 'financing',
        refType: 'position',
        refId: fresh.id,
        memo: `financing ${new Date(chargeDate).toISOString().slice(0, 10)}`,
        entries,
        now,
      })
      if (fromMargin > 0n) {
        repos.trading.updatePosition(fresh.id, {
          marginMicros: fresh.marginMicros - fromMargin,
          lastFinancingAt: chargeDate,
          version: fresh.version,
        })
        repos.trading.createMarginEvent(fresh.id, -fromMargin, 'financing', now)
      } else {
        repos.trading.updatePosition(fresh.id, {
          lastFinancingAt: chargeDate,
          version: fresh.version,
        })
      }
      repos.trading.createFinancingChargeIfAbsent({
        positionId: fresh.id,
        chargeDate,
        rateBps: ctx.config.financing.annualRateBps,
        amountMicros: taken,
        ledgerTxId: txId,
        now,
      })
      return true
    })
    if (result) {
      total += taken
      charged += 1
    }
  }
  return { charged, amountMicros: total }
}

export function reviewWeekendMargins(
  ctx: TradingContext,
): Array<{ positionId: string; required: string; margin: string; action: string }> {
  if (!ctx.config.weekend.enabled) return []
  const now = ctx.clock.now()
  if (!isWeekendWindow(ctx.config, now)) return []
  const results: Array<{ positionId: string; required: string; margin: string; action: string }> =
    []
  for (const pos of ctx.repos.trading.listOpenPositions()) {
    const price = ctx.prices.get(pos.symbol)
    if (!price) continue
    const instrument = instrumentFor(ctx, pos.symbol)
    const mark = dec(price.mid)
    const q2u = quoteToUsd(ctx, instrument, mark)
    const notional = notionalFtk(M(pos.unitsMicros), mark, q2u, ftkUsdRate(ctx))
    const required = weekendMinMargin(notional, ctx.config.weekend.maxLeverage)
    const margin = M(pos.marginMicros)
    if (margin.gte(required)) continue
    if (!ctx.repos.runtime.hasUnreadNotificationForPosition(pos.userId, pos.id, 'weekend.')) {
      ctx.repos.runtime.addNotification(
        pos.userId,
        'weekend.margin',
        {
          positionId: pos.id,
          symbol: pos.symbol,
          required: required.toFixed(8),
          margin: margin.toFixed(8),
        },
        now,
      )
    }
    results.push({
      positionId: pos.id,
      required: required.toFixed(8),
      margin: margin.toFixed(8),
      action: 'margin_call',
    })
  }
  return results
}

function isWeekendReduceWindow(config: TradingContext['config'], now: number): boolean {
  if (!config.weekend.enabled) return false
  const { weekday, minutes } = newYorkClock(now)
  if (weekday !== 'Fri') return false
  const close = 17 * 60
  return minutes >= close - config.weekend.reduceBeforeCloseMinutes && minutes < close
}

/**
 * Weekend risk contraction: once inside the configured reduce window, positions
 * still below the weekend minimum margin are force-closed. Partial reduction
 * cannot fix a leverage-driven deficit under isolated margin (margin is released
 * proportionally), so we close the position rather than pretend to reduce it.
 */
export function enforceWeekendMargins(
  ctx: TradingContext,
): Array<{ positionId: string; result: string }> {
  if (!isWeekendReduceWindow(ctx.config, ctx.clock.now())) return []
  const results: Array<{ positionId: string; result: string }> = []
  for (const pos of ctx.repos.trading.listOpenPositions()) {
    const price = ctx.prices.get(pos.symbol)
    if (!price || price.marketState === 'closed' || price.stale) {
      results.push({ positionId: pos.id, result: 'skipped_stale' })
      continue
    }
    const instrument = instrumentFor(ctx, pos.symbol)
    const mark = dec(price.mid)
    const q2u = quoteToUsd(ctx, instrument, mark)
    const notional = notionalFtk(M(pos.unitsMicros), mark, q2u, ftkUsdRate(ctx))
    const required = weekendMinMargin(notional, ctx.config.weekend.maxLeverage)
    if (M(pos.marginMicros).gte(required)) continue
    try {
      closePosition(ctx, pos.userId, pos.id, {
        reason: 'weekend',
        clientOrderId: `weekend:${pos.id}:${pos.version}`,
      })
      results.push({ positionId: pos.id, result: 'closed' })
    } catch (error) {
      results.push({
        positionId: pos.id,
        result: error instanceof AppError ? error.code : 'INTERNAL',
      })
    }
  }
  return results
}

export function recalcRisk(ctx: TradingContext): number {
  let changed = 0
  const now = ctx.clock.now()
  for (const pos of ctx.repos.trading.listOpenPositions()) {
    const mmr = ctx.config.risk.maintenanceMarginByLeverage[String(pos.leverage)]
    if (mmr === undefined || mmr === pos.maintenanceRatioBps) continue
    ctx.uow.run((repos) => {
      const fresh = repos.trading.findPositionById(pos.id)
      if (!fresh || fresh.status !== 'open') return
      repos.trading.updatePositionMaintenanceRatio(fresh.id, mmr)
      repos.runtime.addNotification(
        fresh.userId,
        'risk.recalculated',
        {
          positionId: fresh.id,
          symbol: fresh.symbol,
          maintenanceRatioBps: mmr,
        },
        now,
      )
    })
    changed++
  }
  return changed
}

export function positionSummary(
  ctx: TradingContext,
  pos: PositionRow,
): {
  markPrice: string
  unrealizedPnl: string
  liquidationPrice: string | null
  marginRatio: string
  notionalFtk: string
} {
  const price = ctx.prices.get(pos.symbol)
  const instrument = instrumentFor(ctx, pos.symbol)
  const mark = dec(price?.mid ?? pos.entryPrice)
  const metrics = positionMetrics(
    {
      side: pos.side,
      units: M(pos.unitsMicros),
      entryPrice: dec(pos.entryPrice),
      margin: M(pos.marginMicros),
      maintenanceRatioBps: pos.maintenanceRatioBps,
    },
    mark,
    instrument,
    ftkUsdRate(ctx),
  )
  return {
    markPrice: mark.toFixed(instrument.pricePrecision),
    unrealizedPnl: metrics.unrealizedPnl.toFixed(8),
    liquidationPrice: liquidationForPosition(ctx, pos),
    marginRatio: metrics.marginRatio.toFixed(4),
    notionalFtk: metrics.notional.toFixed(8),
  }
}
