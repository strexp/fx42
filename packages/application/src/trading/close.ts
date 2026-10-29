import Decimal from 'decimal.js'
import { AppError, dec, fromMicros, toMicros } from '@fx42/shared'
import {
  fillPrice,
  notionalFtk,
  orderRiskGate,
  unitsToLots,
  type InstrumentConfig,
} from '@fx42/domain'
import { ftkUsdRate, getUser, instrumentFor, priceFor, quoteToUsd } from './../helpers'
import type { TradingContext } from '../ports'
import type { OrderRiskInput } from '@fx42/domain'
import { riskInputFor } from './orders'
import type { OrderRow, PositionRow } from '@fx42/db'
import { M } from './shared'
import {
  executeClosePlan,
  planClose,
  type ClosePositionResult,
  type CloseReason,
} from './close-plan'

export type { ClosePositionResult, CloseReason } from './close-plan'

interface ResolvedClose {
  closedMicros: bigint
  remainingMicros: bigint
  fullyClosed: boolean
}

function resolveCloseUnits(
  pos: PositionRow,
  instrument: InstrumentConfig,
  unitsInput?: string,
): ResolvedClose {
  const totalMicros = pos.unitsMicros
  let closedMicros = totalMicros
  if (unitsInput !== undefined) {
    const requested = dec(unitsInput)
    if (!requested.isFinite() || requested.lte(0)) throw new AppError('INVALID_UNITS')
    try {
      closedMicros = toMicros(requested)
    } catch {
      throw new AppError('INVALID_UNITS')
    }
  }
  if (closedMicros <= 0n) throw new AppError('INVALID_UNITS')
  if (closedMicros > totalMicros) {
    throw new AppError('INVALID_UNITS', { details: { maxUnits: fromMicros(totalMicros) } })
  }
  if (closedMicros === totalMicros) {
    return { closedMicros, remainingMicros: 0n, fullyClosed: true }
  }

  const step = new Decimal(instrument.contractSize).mul(instrument.lotStep)
  const minRemaining = new Decimal(instrument.contractSize).mul(instrument.minLots)
  const stepMicros = step.gt(0) ? toMicros(step) : 0n
  const minRemainingMicros = minRemaining.gt(0) ? toMicros(minRemaining) : 0n
  const remainingMicros = totalMicros - closedMicros

  if (stepMicros > 0n && closedMicros % stepMicros !== 0n) {
    throw new AppError('INVALID_UNITS', { details: { stepUnits: fromMicros(stepMicros) } })
  }
  if (stepMicros > 0n && remainingMicros % stepMicros !== 0n) {
    throw new AppError('INVALID_UNITS', {
      details: {
        stepUnits: fromMicros(stepMicros),
        maxPartialUnits: fromMicros(
          totalMicros > minRemainingMicros ? totalMicros - minRemainingMicros : 0n,
        ),
      },
    })
  }
  if (remainingMicros < minRemainingMicros) {
    throw new AppError('INVALID_UNITS', {
      details: {
        minRemainingUnits: fromMicros(minRemainingMicros),
        maxPartialUnits: fromMicros(
          totalMicros > minRemainingMicros ? totalMicros - minRemainingMicros : 0n,
        ),
      },
    })
  }
  return { closedMicros, remainingMicros, fullyClosed: false }
}

function existingCloseResult(
  ctx: TradingContext,
  pos: PositionRow,
  existing: OrderRow,
): ClosePositionResult {
  if (existing.positionId !== pos.id || existing.status !== 'filled' || !existing.reduceOnly) {
    throw new AppError('IDEMPOTENCY_CONFLICT')
  }
  const fill = ctx.repos.trading.findFillByOrderId(existing.id)
  const current = ctx.repos.trading.findPositionById(pos.id)
  const open = current?.status === 'open'
  return {
    order: existing,
    position: open ? current : null,
    closePrice: existing.filledPrice ?? '0',
    realized: fill ? fromMicros(fill.realizedPnlMicros) : '0',
    closedUnits: fromMicros(existing.unitsMicros),
    remainingUnits: open && current ? fromMicros(current.unitsMicros) : '0',
    fullyClosed: !open,
  }
}

export function closePosition(
  ctx: TradingContext,
  userId: string,
  positionId: string,
  input: {
    units?: string
    confirmStale?: boolean
    reason?: CloseReason
    clientOrderId?: string
  },
): ClosePositionResult {
  const pos = ctx.repos.trading.findPositionById(positionId)
  if (!pos || pos.userId !== userId) throw new AppError('POSITION_NOT_FOUND')
  const account = ctx.repos.users.findAccountById(pos.accountId)
  if (!account) throw new AppError('ACCOUNT_INVALID')

  if (input.clientOrderId) {
    const existing = ctx.repos.trading.findOrderByClientId(account.id, input.clientOrderId)
    if (existing) return existingCloseResult(ctx, pos, existing)
  }

  if (pos.status !== 'open') throw new AppError('POSITION_CLOSED')
  const user = getUser(ctx, userId)
  const price = priceFor(ctx, pos.symbol)
  const instrument = instrumentFor(ctx, pos.symbol)
  const resolved = resolveCloseUnits(pos, instrument, input.units)
  const units = M(resolved.closedMicros)
  const reason = input.reason ?? 'manual'
  if (reason === 'manual') {
    const reduce = !resolved.fullyClosed
    const gate: OrderRiskInput = {
      ...riskInputFor(
        ctx,
        {
          mode: account.mode,
          symbol: pos.symbol,
          side: pos.side === 'long' ? 'short' : 'long',
          units: units.toString(),
          leverage: pos.leverage,
          clientOrderId: input.clientOrderId ?? 'close',
          confirmStale: input.confirmStale,
          reduceOnly: true,
        },
        account.id,
        {
          instrument,
          price,
          units,
          unitsMicros: resolved.closedMicros,
          lots: unitsToLots(units, instrument),
          fill: fillPrice(
            dec(price.bid),
            dec(price.ask),
            pos.side === 'long' ? 'short' : 'long',
            ctx.config.fees.spreadMarkupBps,
          ),
          q2u: quoteToUsd(ctx, instrument, dec(price.mid)),
          notional: notionalFtk(
            units,
            dec(price.mid),
            quoteToUsd(ctx, instrument, dec(price.mid)),
            ftkUsdRate(ctx),
          ),
          margin: new Decimal(0),
          fee: new Decimal(0),
        },
        pos,
      ),
      action: reduce ? 'reduce' : 'close',
      userStatus: user.status,
      termsAccepted: !!ctx.repos.users.findTerms(userId),
    }
    const error = orderRiskGate(gate)
    if (error) throw new AppError(error)
  }
  const fill =
    reason === 'liquidation'
      ? pos.side === 'long'
        ? dec(price.bid)
        : dec(price.ask)
      : fillPrice(
          dec(price.bid),
          dec(price.ask),
          pos.side === 'long' ? 'short' : 'long',
          ctx.config.fees.spreadMarkupBps,
        )
  const plan = planClose(ctx, {
    pos,
    closedUnitsMicros: resolved.closedMicros,
    fill,
    reason,
  })

  return ctx.uow.run((repos) => {
    const now = ctx.clock.now()
    const order = repos.trading.createOrder({
      userId: pos.userId,
      accountId: account.id,
      symbol: pos.symbol,
      side: pos.side === 'long' ? 'short' : 'long',
      unitsMicros: resolved.closedMicros,
      leverage: pos.leverage,
      status: 'filled',
      clientOrderId: input.clientOrderId ?? `${reason}:${pos.id}:${pos.version}:${now}`,
      filledPrice: plan.priceStr,
      notionalMicros: toMicros(plan.notional),
      feeMicros: plan.closeFeeMicros,
      positionId: pos.id,
      reduceOnly: true,
      now,
    })
    return executeClosePlan(ctx, repos, plan, order)
  })
}
