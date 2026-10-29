import Decimal from 'decimal.js'
import { AppError, dec, fromMicros, toMicros } from '@fx42/shared'
import {
  notionalFtk,
  openFee as calcOpenFee,
  realizedPnl as calcRealizedPnl,
  settleClose,
} from '@fx42/domain'
import { ftkUsdRate, instrumentFor, quoteToUsd } from './../helpers'
import type { Repos, TradingContext } from '../ports'
import type { OrderRow, PositionRow } from '@fx42/db'
import { M } from './shared'

export type CloseReason = 'manual' | 'tp' | 'sl' | 'auto' | 'ops' | 'weekend' | 'liquidation'

export interface ClosePositionResult {
  order: OrderRow
  position: PositionRow | null
  closePrice: string
  realized: string
  closedUnits: string
  remainingUnits: string
  fullyClosed: boolean
}

export interface ClosePlan {
  pos: PositionRow
  account: { id: string; mode: 'real' | 'virtual'; userId: string }
  closedUnitsMicros: bigint
  fullyClosed: boolean
  fill: Decimal
  notional: Decimal
  realized: Decimal
  reason: CloseReason
  closeFee: Decimal
  closeFeeMicros: bigint
  realizedMicros: bigint
  marginReleaseMicros: bigint
  penaltyMicros: bigint
  forced: boolean
  priceStr: string
  settlement: ReturnType<typeof settleClose>
}

/**
 * Pure close calculation. Shared by the manual close use case, the order
 * use case (reduce/close/flip) and liquidation paths so fees, margin release,
 * settlement and ledger entries are always derived the same way.
 */
export function planClose(
  ctx: TradingContext,
  input: {
    pos: PositionRow
    closedUnitsMicros: bigint
    fill: Decimal
    reason: CloseReason
  },
): ClosePlan {
  const { pos, closedUnitsMicros, fill, reason } = input
  const account = ctx.repos.users.findAccountById(pos.accountId)
  if (!account) throw new AppError('ACCOUNT_INVALID')
  if (closedUnitsMicros <= 0n) throw new AppError('INVALID_UNITS')
  if (closedUnitsMicros > pos.unitsMicros) throw new AppError('INVALID_UNITS')

  const instrument = instrumentFor(ctx, pos.symbol)
  const units = M(closedUnitsMicros)
  const q2u = quoteToUsd(ctx, instrument, fill)
  const notional = notionalFtk(units, fill, q2u, ftkUsdRate(ctx))
  const realized = calcRealizedPnl(pos.side, dec(pos.entryPrice), fill, units, q2u, ftkUsdRate(ctx))
  const fullyClosed = closedUnitsMicros >= pos.unitsMicros
  const forced = reason === 'liquidation'
  const closeFee = forced ? new Decimal(0) : calcOpenFee(notional, ctx.config.fees.takerBps)
  const closeFeeMicros = toMicros(closeFee, 'ceil')
  const marginReleaseMicros = (pos.marginMicros * closedUnitsMicros) / pos.unitsMicros
  const marginRelease = M(marginReleaseMicros)
  const insuranceBalance = M(ctx.repos.wallets.systemBalance(account.mode, 'insurance_fund'))
  const settlement = settleClose({
    margin: marginRelease,
    realized: realized.minus(closeFee),
    notional,
    liquidationFeeBps: ctx.config.risk.liquidationFeeBps,
    insuranceBalance,
    forcedLiquidation: forced,
  })
  if (!fullyClosed && settlement.equity.lt(0)) {
    throw new AppError('MARGIN_REQUIRED', {
      message: 'partial close would produce negative equity; close the position fully',
    })
  }

  return {
    pos,
    account,
    closedUnitsMicros,
    fullyClosed,
    fill,
    notional,
    realized,
    reason,
    closeFee,
    closeFeeMicros,
    realizedMicros: toMicros(realized, 'half-up'),
    marginReleaseMicros,
    penaltyMicros: toMicros(settlement.penalty, 'ceil'),
    forced,
    priceStr: fill.toFixed(instrument.pricePrecision),
    settlement,
  }
}

/**
 * Apply a close plan to the ledger and position. The caller owns the
 * transaction and must create the order record first.
 */
export function executeClosePlan(
  ctx: TradingContext,
  repos: Repos,
  plan: ClosePlan,
  order: OrderRow,
): ClosePositionResult {
  const { pos, account, closedUnitsMicros, fullyClosed, reason, forced } = plan
  const now = ctx.clock.now()

  const fresh = repos.trading.findPositionById(pos.id)
  if (!fresh || fresh.status !== 'open') throw new AppError('POSITION_CLOSED')
  if (fresh.version !== pos.version) {
    throw new AppError('POSITION_CLOSED', { message: 'position changed' })
  }
  const wallet = repos.wallets.findUserWallet(account.id)
  if (!wallet) throw new AppError('ACCOUNT_INVALID')

  const entries: Array<{ walletId: string; amountMicros: bigint }> = [
    { walletId: `sys:${account.mode}:margin_pool`, amountMicros: -plan.marginReleaseMicros },
  ]
  if (plan.settlement.equity.gte(0)) {
    const credit = toMicros(plan.settlement.userCredit, 'half-up')
    if (credit !== 0n) entries.push({ walletId: wallet.id, amountMicros: credit })
  }
  if (plan.settlement.insuranceDelta.gt(0)) {
    entries.push({
      walletId: `sys:${account.mode}:insurance_fund`,
      amountMicros: plan.penaltyMicros,
    })
  } else if (plan.settlement.insuranceDelta.lt(0)) {
    entries.push({
      walletId: `sys:${account.mode}:insurance_fund`,
      amountMicros: toMicros(plan.settlement.insuranceDelta, 'half-up'),
    })
  }
  if (plan.settlement.badDebtDelta.lt(0)) {
    entries.push({
      walletId: `sys:${account.mode}:bad_debt`,
      amountMicros: toMicros(plan.settlement.badDebtDelta, 'half-up'),
    })
  }
  if (plan.realizedMicros !== 0n) {
    entries.push({
      walletId: `sys:${account.mode}:exchange_pnl`,
      amountMicros: -plan.realizedMicros,
    })
  }
  if (plan.closeFeeMicros !== 0n && !forced) {
    entries.push({
      walletId: `sys:${account.mode}:fee_income`,
      amountMicros: plan.closeFeeMicros,
    })
  }
  repos.wallets.postLedger({
    mode: account.mode,
    type: forced ? 'liquidation' : 'realized_pnl',
    refType: 'position',
    refId: fresh.id,
    memo: `close ${reason}`,
    entries,
    now,
  })
  if (plan.settlement.badDebtDelta.lt(0)) {
    repos.runtime.setFlag('halt_opening', '1', 'bad debt incurred', 'risk', now)
    repos.runtime.addNotification(
      fresh.userId,
      'bad_debt',
      {
        positionId: fresh.id,
        symbol: fresh.symbol,
        badDebt: fromMicros(toMicros(plan.settlement.badDebtDelta, 'half-up')),
      },
      now,
    )
  }

  if (closedUnitsMicros > fresh.unitsMicros) throw new AppError('INVALID_UNITS')
  const closeStatus = forced ? 'liquidated' : 'closed'
  if (fullyClosed) {
    repos.trading.closePosition(fresh.id, {
      status: closeStatus,
      closePrice: plan.priceStr,
      closeReason: reason,
      unitsMicros: 0n,
      marginMicros: 0n,
      realizedPnlMicros: fresh.realizedPnlMicros + plan.realizedMicros,
      now,
      version: fresh.version,
    })
    repos.trading.cancelTriggers(fresh.id)
  } else {
    repos.trading.updatePosition(fresh.id, {
      unitsMicros: fresh.unitsMicros - closedUnitsMicros,
      marginMicros: fresh.marginMicros - plan.marginReleaseMicros,
      realizedPnlMicros: fresh.realizedPnlMicros + plan.realizedMicros,
      version: fresh.version,
    })
  }
  if (forced) {
    repos.trading.createLiquidation({
      positionId: fresh.id,
      userId: fresh.userId,
      markPrice: ctx.prices.get(fresh.symbol)?.mid ?? plan.priceStr,
      closePrice: plan.priceStr,
      equityMicros: toMicros(plan.settlement.equity, 'half-up'),
      deficitMicros: toMicros(plan.settlement.deficit, 'half-up'),
      penaltyMicros: plan.penaltyMicros,
      now,
    })
    repos.runtime.addNotification(
      fresh.userId,
      'liquidation',
      {
        positionId: fresh.id,
        symbol: fresh.symbol,
        closePrice: plan.priceStr,
        penalty: fromMicros(plan.penaltyMicros),
      },
      now,
    )
  } else {
    repos.runtime.addNotification(
      fresh.userId,
      'position.closed',
      {
        positionId: fresh.id,
        symbol: fresh.symbol,
        closePrice: plan.priceStr,
        reason,
        realized: fromMicros(plan.realizedMicros),
        fullyClosed,
      },
      now,
    )
  }

  repos.trading.createFill({
    orderId: order.id,
    userId: fresh.userId,
    accountId: account.id,
    positionId: fresh.id,
    symbol: fresh.symbol,
    side: fresh.side === 'long' ? 'short' : 'long',
    action: fullyClosed ? 'close' : 'reduce',
    unitsMicros: closedUnitsMicros,
    price: plan.priceStr,
    notionalMicros: toMicros(plan.notional),
    feeMicros: plan.closeFeeMicros,
    realizedPnlMicros: plan.realizedMicros,
    now,
  })
  const remainingMicros = fullyClosed ? 0n : fresh.unitsMicros - closedUnitsMicros
  return {
    order,
    position: fullyClosed ? null : repos.trading.findPositionById(fresh.id)!,
    closePrice: plan.priceStr,
    realized: fromMicros(plan.realizedMicros),
    closedUnits: fromMicros(closedUnitsMicros),
    remainingUnits: fromMicros(remainingMicros),
    fullyClosed,
  }
}
