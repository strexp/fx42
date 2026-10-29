import Decimal from 'decimal.js'
import { AppError, dec, toMicros } from '@fx42/shared'
import {
  calcLiquidationPrice,
  effectiveMaxLots,
  fillPrice,
  marginFor,
  notionalFtk,
  openFee as calcOpenFee,
  realizedPnl as calcRealizedPnl,
  roundPriceConservative,
  unitsToLots,
  validateLots,
  validateTpSl,
  weightedEntry,
  type InstrumentConfig,
} from '@fx42/domain'
import {
  accountOpenNotionalFtk,
  availableBalance,
  getAccount,
  getUser,
  instrumentFor,
  isWeekendWindow,
  priceFor,
  quoteToUsd,
  requireTerms,
  ftkUsdRate,
} from '../helpers'
import { orderRiskGate, type OrderAction, type OrderRiskInput } from '@fx42/domain'
import type { TradingContext, PriceSnapshot } from '../ports'
import type { OrderRow, PositionRow } from '@fx42/db'
import { executeClosePlan, planClose } from './close-plan'

import { M } from './shared'

export interface PlaceOrderParams {
  mode: 'real' | 'virtual'
  symbol: string
  side: 'long' | 'short'
  lots?: string
  units?: string
  leverage: number
  clientOrderId: string
  takeProfit?: string
  stopLoss?: string
  confirmStale?: boolean
  reduceOnly?: boolean
}

export type PreviewAction = 'open' | 'increase' | 'reduce' | 'close' | 'flip'

export interface PreviewResult {
  symbol: string
  side: 'long' | 'short'
  action: PreviewAction
  fillPrice: string
  units: string
  lots: string
  notionalFtk: string
  /** Margin locked for open/increase, released for reduce/close, new margin for flip. */
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

interface ResolvedOrder {
  instrument: InstrumentConfig
  price: PriceSnapshot
  units: Decimal
  unitsMicros: bigint
  lots: Decimal
  fill: Decimal
  q2u: Decimal
  notional: Decimal
  margin: Decimal
  fee: Decimal
}

function resolveUnits(
  ctx: TradingContext,
  instrument: InstrumentConfig,
  input: { lots?: string; units?: string },
  price: Decimal,
): { units: Decimal; lots: Decimal } {
  if ((input.lots === undefined) === (input.units === undefined)) {
    throw new AppError('VALIDATION_ERROR', { message: 'provide exactly one of lots or units' })
  }
  const lots =
    input.lots !== undefined ? dec(input.lots) : unitsToLots(dec(input.units!), instrument)
  const check = validateLots(lots, instrument)
  if (!check.ok) throw new AppError('INVALID_LOTS', { details: { reason: check.reason } })
  const units = check.units
  if (units.lte(0)) throw new AppError('INVALID_UNITS')
  const max = effectiveMaxLots(
    instrument,
    price,
    ftkUsdRate(ctx),
    dec(ctx.config.risk.maxOrderNotional),
  )
  if (lots.gt(max)) throw new AppError('ORDER_TOO_LARGE', { details: { maxLots: max.toString() } })
  return { units, lots }
}

function buildOrder(ctx: TradingContext, input: PlaceOrderParams): ResolvedOrder {
  const instrument = instrumentFor(ctx, input.symbol)
  const price = priceFor(ctx, input.symbol)
  const { units, lots } = resolveUnits(ctx, instrument, input, dec(price.mid))
  const fill = fillPrice(
    dec(price.bid),
    dec(price.ask),
    input.side,
    ctx.config.fees.spreadMarkupBps,
  )
  const q2u = quoteToUsd(ctx, instrument, fill)
  const notional = notionalFtk(units, fill, q2u, ftkUsdRate(ctx))
  const margin = marginFor(notional, input.leverage)
  const fee = calcOpenFee(notional, ctx.config.fees.takerBps, ctx.config.fees.minOpenFee)
  return {
    instrument,
    price,
    units,
    unitsMicros: toMicros(units),
    lots,
    fill,
    q2u,
    notional,
    margin,
    fee,
  }
}

export function liquidationPriceFor(
  ctx: TradingContext,
  instrument: InstrumentConfig,
  input: {
    side: 'long' | 'short'
    entry: Decimal
    units: Decimal
    margin: Decimal
    maintenanceRatioBps: number
  },
): string | null {
  const raw = calcLiquidationPrice(
    {
      side: input.side,
      entryPrice: input.entry,
      units: input.units,
      margin: input.margin,
      maintenanceRatioBps: input.maintenanceRatioBps,
    },
    instrument,
    ftkUsdRate(ctx),
  )
  if (!raw) return null
  return roundPriceConservative(raw, instrument.pricePrecision, input.side).toFixed(
    instrument.pricePrecision,
  )
}

export function previewOrder(
  ctx: TradingContext,
  userId: string,
  input: PlaceOrderParams,
): PreviewResult {
  const account = getAccount(ctx, userId, input.mode)
  const order = buildOrder(ctx, input)
  const mmr = ctx.config.risk.maintenanceMarginByLeverage[String(input.leverage)]
  if (mmr === undefined) throw new AppError('INVALID_LEVERAGE')
  const ftk = ftkUsdRate(ctx)
  const pos = ctx.repos.trading.findOpenPosition(account.id, input.symbol)
  const base = {
    symbol: input.symbol,
    side: input.side,
    fillPrice: order.fill.toFixed(order.instrument.pricePrecision),
    units: order.units.toString(),
    lots: order.lots.toString(),
    notionalFtk: order.notional.toFixed(8),
    effectiveMaxLots: effectiveMaxLots(
      order.instrument,
      dec(order.price.mid),
      ftk,
      dec(ctx.config.risk.maxOrderNotional),
    ).toString(),
  }

  if (!pos) {
    const liq = liquidationPriceFor(ctx, order.instrument, {
      side: input.side,
      entry: order.fill,
      units: order.units,
      margin: order.margin,
      maintenanceRatioBps: mmr,
    })
    return {
      ...base,
      action: 'open',
      margin: order.margin.toFixed(8),
      openFee: order.fee.toFixed(8),
      closeFee: '0',
      liquidationPrice: liq,
      maxLoss: order.margin.toFixed(8),
      realizedPnl: null,
      existingUnits: null,
      resultingUnits: order.units.toString(),
      resultingEntryPrice: order.fill.toFixed(order.instrument.pricePrecision),
      resultingMargin: order.margin.toFixed(8),
      resultingNotionalFtk: order.notional.toFixed(8),
    }
  }

  const posUnits = M(pos.unitsMicros)
  const posMargin = M(pos.marginMicros)

  if (pos.side === input.side) {
    if (pos.leverage !== input.leverage) throw new AppError('LEVERAGE_MISMATCH')
    const totalUnits = posUnits.plus(order.units)
    const totalMargin = posMargin.plus(order.margin)
    const entry = weightedEntry(dec(pos.entryPrice), posUnits, order.fill, order.units)
    const liq = liquidationPriceFor(ctx, order.instrument, {
      side: input.side,
      entry,
      units: totalUnits,
      margin: totalMargin,
      maintenanceRatioBps: pos.maintenanceRatioBps,
    })
    return {
      ...base,
      action: 'increase',
      margin: order.margin.toFixed(8),
      openFee: order.fee.toFixed(8),
      closeFee: '0',
      liquidationPrice: liq,
      maxLoss: totalMargin.toFixed(8),
      realizedPnl: null,
      existingUnits: posUnits.toString(),
      resultingUnits: totalUnits.toString(),
      resultingEntryPrice: entry.toFixed(order.instrument.pricePrecision),
      resultingMargin: totalMargin.toFixed(8),
      resultingNotionalFtk: notionalFtk(totalUnits, order.fill, order.q2u, ftk).toFixed(8),
    }
  }

  // Opposite direction: reduce, close, or flip.
  const closedUnits = Decimal.min(order.units, posUnits)
  const remainingOrderUnits = order.units.minus(closedUnits)
  const closedUnitsMicros = Decimal.min(dec(order.unitsMicros), dec(pos.unitsMicros)).toFixed(0)
  const marginReleaseMicros = (pos.marginMicros * BigInt(closedUnitsMicros)) / pos.unitsMicros
  const marginRelease = M(marginReleaseMicros)
  const closeNotional = notionalFtk(closedUnits, order.fill, order.q2u, ftk)
  const closeFee = calcOpenFee(closeNotional, ctx.config.fees.takerBps)
  const realized = calcRealizedPnl(
    pos.side,
    dec(pos.entryPrice),
    order.fill,
    closedUnits,
    order.q2u,
    ftk,
  )
  const remainingPosUnits = posUnits.minus(closedUnits)
  const remainingMargin = posMargin.minus(marginRelease)

  if (remainingOrderUnits.gt(0)) {
    const remNotional = notionalFtk(remainingOrderUnits, order.fill, order.q2u, ftk)
    const remMargin = marginFor(remNotional, input.leverage)
    const remFee = calcOpenFee(remNotional, ctx.config.fees.takerBps, ctx.config.fees.minOpenFee)
    const liq = liquidationPriceFor(ctx, order.instrument, {
      side: input.side,
      entry: order.fill,
      units: remainingOrderUnits,
      margin: remMargin,
      maintenanceRatioBps: mmr,
    })
    return {
      ...base,
      action: 'flip',
      margin: remMargin.toFixed(8),
      openFee: remFee.toFixed(8),
      closeFee: closeFee.toFixed(8),
      liquidationPrice: liq,
      maxLoss: remMargin.toFixed(8),
      realizedPnl: realized.toFixed(8),
      existingUnits: posUnits.toString(),
      resultingUnits: remainingOrderUnits.toString(),
      resultingEntryPrice: order.fill.toFixed(order.instrument.pricePrecision),
      resultingMargin: remMargin.toFixed(8),
      resultingNotionalFtk: remNotional.toFixed(8),
    }
  }

  const fullyClosed = remainingPosUnits.lte(0)
  const liq = fullyClosed
    ? null
    : liquidationPriceFor(ctx, order.instrument, {
        side: pos.side,
        entry: dec(pos.entryPrice),
        units: remainingPosUnits,
        margin: remainingMargin,
        maintenanceRatioBps: pos.maintenanceRatioBps,
      })
  return {
    ...base,
    action: fullyClosed ? 'close' : 'reduce',
    margin: marginRelease.toFixed(8),
    openFee: '0',
    closeFee: closeFee.toFixed(8),
    liquidationPrice: liq,
    maxLoss: remainingMargin.toFixed(8),
    realizedPnl: realized.toFixed(8),
    existingUnits: posUnits.toString(),
    resultingUnits: remainingPosUnits.toString(),
    resultingEntryPrice: fullyClosed ? null : pos.entryPrice,
    resultingMargin: remainingMargin.toFixed(8),
    resultingNotionalFtk: fullyClosed
      ? '0'
      : notionalFtk(remainingPosUnits, order.fill, order.q2u, ftk).toFixed(8),
  }
}

function determineAction(
  pos: PositionRow | null,
  side: 'long' | 'short',
  reduceOnly: boolean,
  orderUnitsMicros: bigint,
): OrderAction {
  if (!pos) return 'open'
  if (pos.side === side) return reduceOnly ? 'close' : 'increase'
  if (reduceOnly) return 'reduce'
  return orderUnitsMicros > pos.unitsMicros ? 'flip' : 'reduce'
}

export function riskInputFor(
  ctx: TradingContext,
  input: PlaceOrderParams,
  accountId: string,
  order: ResolvedOrder,
  pos: PositionRow | null,
): OrderRiskInput {
  const action = determineAction(pos, input.side, input.reduceOnly ?? false, order.unitsMicros)
  const wallet = ctx.repos.wallets.findUserWallet(accountId)
  if (!wallet) throw new AppError('ACCOUNT_INVALID')
  const currentNotional = accountOpenNotionalFtk(ctx, accountId)
  const mid = dec(order.price.mid)
  const midQ2u = quoteToUsd(ctx, order.instrument, mid)
  // A flip both closes the existing position and opens the remainder. The
  // opening portion must be checked against every opening risk gate, and must
  // not double-count the exposure/margin that is being released.
  const posUnits = pos ? M(pos.unitsMicros) : new Decimal(0)
  const opposite = !!pos && pos.side !== input.side
  const closedUnits = opposite ? Decimal.min(order.units, posUnits) : new Decimal(0)
  const openingUnits = order.units.minus(closedUnits)
  const fullOrderOpening = openingUnits.eq(order.units)
  const openingNotional = fullOrderOpening
    ? order.notional
    : openingUnits.gt(0)
      ? notionalFtk(openingUnits, order.fill, order.q2u, ftkUsdRate(ctx))
      : new Decimal(0)
  const openingMargin = fullOrderOpening
    ? order.margin
    : openingUnits.gt(0)
      ? marginFor(openingNotional, input.leverage)
      : new Decimal(0)
  const openingFee = fullOrderOpening
    ? order.fee
    : openingUnits.gt(0)
      ? calcOpenFee(openingNotional, ctx.config.fees.takerBps, ctx.config.fees.minOpenFee)
      : new Decimal(0)
  const feeMicros = toMicros(openingFee, 'ceil')
  const marginMicros = toMicros(openingMargin, 'ceil')
  const netExposure = ctx.repos.trading.netExposureUsd(
    input.symbol,
    input.mode,
    order.price.mid,
    midQ2u.toString(),
  )
  const posNotionalFtk = pos ? notionalFtk(posUnits, mid, midQ2u, ftkUsdRate(ctx)) : new Decimal(0)
  const posExposureUsd = pos ? posUnits.mul(mid).mul(midQ2u) : new Decimal(0)
  const oldSignedExposureUsd = pos
    ? (pos.side === 'long' ? posExposureUsd : posExposureUsd.neg()).toNumber()
    : 0
  const openingExposureUsd = openingUnits.mul(mid).mul(midQ2u)
  const newSignedExposureUsd = (
    input.side === 'long' ? openingExposureUsd : openingExposureUsd.neg()
  ).toNumber()
  const orderSignedExposureUsd =
    action === 'flip' ? newSignedExposureUsd - oldSignedExposureUsd : newSignedExposureUsd
  const positionCount = ctx.repos.trading.countOpenPositions(accountId)
  const weekend = isWeekendWindow(ctx.config, ctx.clock.now())
  const reserveOk =
    input.mode !== 'real' || ctx.repos.runtime.getFlag('reserve_coverage_ok') !== '0'
  const requiredMargin = M(marginMicros)
  const requiredFee = M(feeMicros)
  const minOrder = dec(ctx.config.risk.minOrderNotional)
  const maxOrder = dec(ctx.config.risk.maxOrderNotional)
  const maxUser = dec(ctx.config.risk.maxUserNotional)
  // `orderNotionalFtk` below is the opening leg; the gate adds it to this
  // base, so do not include it here. A flip first releases the old position.
  const userNotionalBase =
    action === 'flip' ? currentNotional.minus(posNotionalFtk) : currentNotional
  // A flip releases the closing position's margin in the same transaction.
  // Include it in the pre-trade balance check; the execution path performs the
  // final check after the closing leg (including realized PnL) anyway.
  const closedUnitsMicros =
    pos && opposite
      ? order.unitsMicros < pos.unitsMicros
        ? order.unitsMicros
        : pos.unitsMicros
      : 0n
  const releasedMarginMicros =
    pos && pos.unitsMicros > 0n ? (pos.marginMicros * closedUnitsMicros) / pos.unitsMicros : 0n
  const availableForGate =
    action === 'flip'
      ? M(wallet.balanceMicros + releasedMarginMicros)
      : availableBalanceDecimal(ctx, accountId)
  const weekendLeverageOk = !weekend || requiredMargin.lte(availableForGate)
  return {
    action,
    mode: input.mode,
    userStatus: getUser(ctx, ctx.repos.users.findAccountById(accountId)!.userId).status,
    termsAccepted: !!ctx.repos.users.findTerms(ctx.repos.users.findAccountById(accountId)!.userId),
    hasActiveCredential: !!ctx.repos.credentials.findActiveCredential(
      ctx.repos.users.findAccountById(accountId)!.userId,
    ),
    haltOpening: ctx.repos.runtime.getFlag('halt_opening') === '1',
    haltAll: ctx.repos.runtime.getFlag('halt_all') === '1',
    weekendWindow: weekend,
    marketState: order.price.marketState,
    quoteAgeMs: order.price.quoteAgeMs,
    feedGapMs: order.price.feedGapMs,
    spreadSpike: order.price.spreadSpike,
    confirmStale: input.confirmStale ?? false,
    symbolEnabled: true,
    leverage: input.leverage,
    leverageTiers: ctx.config.leverageTiers,
    instrument: order.instrument,
    lotsValid: true,
    unitsValid: true,
    orderNotionalFtk: openingNotional.toNumber(),
    minOrderNotionalFtk: minOrder.toNumber(),
    maxOrderNotionalFtk: maxOrder.toNumber(),
    userNotionalFtk: userNotionalBase.toNumber(),
    maxUserNotionalFtk: maxUser.toNumber(),
    positionCount: pos ? Math.max(0, positionCount - 1) : positionCount,
    maxPositionsPerUser: ctx.config.risk.maxPositionsPerUser,
    orderSignedExposureUsd,
    netExposureUsd: netExposure,
    maxNetExposureUsd: Number(order.instrument.maxNetExposureUsd),
    availableBalanceFtk: availableForGate.toNumber(),
    requiredMarginFtk: requiredMargin.toNumber(),
    requiredFeeFtk: requiredFee.toNumber(),
    reserveCoverageOk: reserveOk,
    staleQuoteMs: ctx.config.risk.staleQuoteMs,
    haltQuoteMs: ctx.config.risk.haltQuoteMs,
    maxStaleCloseFeedGapMs: ctx.config.risk.maxStaleCloseFeedGapMs,
    marketClosedPolicy: ctx.config.risk.marketClosedPolicy,
    weekendLeverageOk,
  }
}

function availableBalanceDecimal(ctx: TradingContext, accountId: string): Decimal {
  return M(availableBalance(ctx, accountId))
}

function lockOpeningMargin(
  repos: TradingContext['repos'],
  input: {
    accountId: string
    mode: 'real' | 'virtual'
    userId: string
    symbol: string
    side: 'long' | 'short'
    leverage: number
    maintenanceRatioBps: number
    unitsMicros: bigint
    entryPrice: string
    margin: Decimal
    fee: Decimal
    refId: string
    memo: string
    now: number
  },
): { position: PositionRow; marginMicros: bigint; feeMicros: bigint } {
  const wallet = repos.wallets.findUserWallet(input.accountId)
  if (!wallet) throw new AppError('ACCOUNT_INVALID')
  const marginMicros = toMicros(input.margin, 'ceil')
  const feeMicros = toMicros(input.fee, 'ceil')
  if (wallet.balanceMicros < marginMicros + feeMicros) {
    throw new AppError('INSUFFICIENT_BALANCE')
  }
  repos.wallets.postLedger({
    mode: input.mode,
    type: 'margin_lock',
    refType: 'order',
    refId: input.refId,
    memo: input.memo,
    entries: [
      { walletId: wallet.id, amountMicros: -marginMicros - feeMicros },
      { walletId: `sys:${input.mode}:margin_pool`, amountMicros: marginMicros },
      { walletId: `sys:${input.mode}:fee_income`, amountMicros: feeMicros },
    ],
    now: input.now,
  })
  const position = repos.trading.createPosition({
    userId: input.userId,
    accountId: input.accountId,
    symbol: input.symbol,
    side: input.side,
    unitsMicros: input.unitsMicros,
    entryPrice: input.entryPrice,
    leverage: input.leverage,
    maintenanceRatioBps: input.maintenanceRatioBps,
    marginMicros,
    openFeeMicros: feeMicros,
    now: input.now,
  })
  return { position, marginMicros, feeMicros }
}

export function placeOrder(
  ctx: TradingContext,
  userId: string,
  input: PlaceOrderParams,
): { order: OrderRow; position: PositionRow | null } {
  const account = getAccount(ctx, userId, input.mode)
  const user = getUser(ctx, userId)
  if (user.status !== 'active' && !input.reduceOnly) {
    throw new AppError('USER_SUSPENDED')
  }
  if (!input.reduceOnly) requireTerms(ctx.repos, userId)
  const existing = ctx.repos.trading.findOrderByClientId(account.id, input.clientOrderId)
  if (existing) {
    if (
      existing.symbol !== input.symbol ||
      existing.side !== input.side ||
      existing.leverage !== input.leverage
    ) {
      throw new AppError('IDEMPOTENCY_CONFLICT')
    }
    if (input.units !== undefined && toMicros(input.units) !== existing.unitsMicros) {
      throw new AppError('IDEMPOTENCY_CONFLICT')
    }
    return {
      order: existing,
      position: existing.positionId
        ? ctx.repos.trading.findPositionById(existing.positionId)
        : null,
    }
  }
  if (!input.reduceOnly) {
    const cooldown = ctx.repos.runtime.getFlag(`cooldown:${userId}`)
    if (cooldown && Number(cooldown) > ctx.clock.now()) {
      throw new AppError('HALTED', { message: 'cooldown after liquidation' })
    }
  }
  const order = buildOrder(ctx, input)
  const pos = ctx.repos.trading.findOpenPosition(account.id, input.symbol)
  if (input.reduceOnly && pos && pos.side !== input.side && order.unitsMicros > pos.unitsMicros) {
    throw new AppError('INVALID_UNITS', { message: 'reduce-only order exceeds position size' })
  }
  const action = determineAction(pos, input.side, input.reduceOnly ?? false, order.unitsMicros)
  const mmr = ctx.config.risk.maintenanceMarginByLeverage[String(input.leverage)]
  if (mmr === undefined) throw new AppError('INVALID_LEVERAGE')
  if (pos && action === 'increase' && pos.leverage !== input.leverage) {
    throw new AppError('LEVERAGE_MISMATCH')
  }
  const risk = riskInputFor(ctx, input, account.id, order, pos)
  const error = orderRiskGate(risk)
  if (error) throw new AppError(error)

  const now = ctx.clock.now()
  return ctx.uow.run((repos) => {
    const duplicate = repos.trading.findOrderByClientId(account.id, input.clientOrderId)
    if (duplicate) {
      if (
        duplicate.symbol !== input.symbol ||
        duplicate.side !== input.side ||
        duplicate.leverage !== input.leverage
      ) {
        throw new AppError('IDEMPOTENCY_CONFLICT')
      }
      return {
        order: duplicate,
        position: duplicate.positionId
          ? repos.trading.findPositionById(duplicate.positionId)
          : null,
      }
    }
    const freshPos = repos.trading.findOpenPosition(account.id, input.symbol)
    if (freshPos) {
      const freshAction = determineAction(
        freshPos,
        input.side,
        input.reduceOnly ?? false,
        order.unitsMicros,
      )
      if (freshAction === 'increase' && freshPos.leverage !== input.leverage) {
        throw new AppError('LEVERAGE_MISMATCH')
      }
    }
    const wallet = repos.wallets.findUserWallet(account.id)
    if (!wallet) throw new AppError('ACCOUNT_INVALID')

    // Purely opening (no existing position).
    if (!freshPos) {
      const opened = lockOpeningMargin(repos, {
        accountId: account.id,
        mode: input.mode,
        userId,
        symbol: input.symbol,
        side: input.side,
        leverage: input.leverage,
        maintenanceRatioBps: mmr,
        unitsMicros: order.unitsMicros,
        entryPrice: order.fill.toFixed(order.instrument.pricePrecision),
        margin: order.margin,
        fee: order.fee,
        refId: input.clientOrderId,
        memo: 'open position margin',
        now,
      })
      const created = repos.trading.createOrder({
        userId,
        accountId: account.id,
        symbol: input.symbol,
        side: input.side,
        unitsMicros: order.unitsMicros,
        leverage: input.leverage,
        status: 'filled',
        clientOrderId: input.clientOrderId,
        filledPrice: order.fill.toFixed(order.instrument.pricePrecision),
        notionalMicros: toMicros(order.notional),
        feeMicros: opened.feeMicros,
        positionId: opened.position.id,
        now,
      })
      repos.trading.createFill({
        orderId: created.id,
        userId,
        accountId: account.id,
        positionId: opened.position.id,
        symbol: input.symbol,
        side: input.side,
        action: 'open',
        unitsMicros: order.unitsMicros,
        price: created.filledPrice!,
        notionalMicros: created.notionalMicros,
        feeMicros: opened.feeMicros,
        realizedPnlMicros: 0n,
        now,
      })
      if (input.takeProfit || input.stopLoss) {
        applyTpSlToPosition(ctx, repos, opened.position.id, input.takeProfit, input.stopLoss)
      }
      return { order: created, position: repos.trading.findPositionById(opened.position.id)! }
    }

    if (freshPos.side === input.side) {
      const incNotional = order.notional
      const incMargin = marginFor(incNotional, input.leverage)
      const incFee = calcOpenFee(incNotional, ctx.config.fees.takerBps, ctx.config.fees.minOpenFee)
      const incMarginMicros = toMicros(incMargin, 'ceil')
      const incFeeMicros = toMicros(incFee, 'ceil')
      if (wallet.balanceMicros < incMarginMicros + incFeeMicros)
        throw new AppError('INSUFFICIENT_BALANCE')
      repos.wallets.postLedger({
        mode: input.mode,
        type: 'margin_lock',
        refType: 'order',
        refId: input.clientOrderId,
        memo: 'increase position margin',
        entries: [
          { walletId: wallet.id, amountMicros: -incMarginMicros - incFeeMicros },
          { walletId: `sys:${input.mode}:margin_pool`, amountMicros: incMarginMicros },
          { walletId: `sys:${input.mode}:fee_income`, amountMicros: incFeeMicros },
        ],
        now,
      })
      const position = repos.trading.updatePosition(freshPos.id, {
        unitsMicros: freshPos.unitsMicros + order.unitsMicros,
        entryPrice: weightedEntry(
          dec(freshPos.entryPrice),
          M(freshPos.unitsMicros),
          order.fill,
          order.units,
        ).toFixed(18),
        marginMicros: freshPos.marginMicros + incMarginMicros,
        version: freshPos.version,
      })
      const created = repos.trading.createOrder({
        userId,
        accountId: account.id,
        symbol: input.symbol,
        side: input.side,
        unitsMicros: order.unitsMicros,
        leverage: input.leverage,
        status: 'filled',
        clientOrderId: input.clientOrderId,
        filledPrice: order.fill.toFixed(order.instrument.pricePrecision),
        notionalMicros: toMicros(order.notional),
        feeMicros: incFeeMicros,
        positionId: position.id,
        now,
      })
      repos.trading.createFill({
        orderId: created.id,
        userId,
        accountId: account.id,
        positionId: position.id,
        symbol: input.symbol,
        side: input.side,
        action: 'increase',
        unitsMicros: order.unitsMicros,
        price: created.filledPrice!,
        notionalMicros: toMicros(order.notional),
        feeMicros: incFeeMicros,
        realizedPnlMicros: 0n,
        now,
      })
      if (input.takeProfit || input.stopLoss) {
        applyTpSlToPosition(ctx, repos, position.id, input.takeProfit, input.stopLoss)
      }
      return { order: created, position: repos.trading.findPositionById(position.id)! }
    }

    // Opposite direction: close the existing position with the same plan and
    // execution path as closePosition, then open any remainder as a flip.
    const closedUnitsMicros =
      order.unitsMicros < freshPos.unitsMicros ? order.unitsMicros : freshPos.unitsMicros
    const plan = planClose(ctx, {
      pos: freshPos,
      closedUnitsMicros,
      fill: order.fill,
      reason: 'manual',
    })
    const created = repos.trading.createOrder({
      userId,
      accountId: account.id,
      symbol: input.symbol,
      side: input.side,
      unitsMicros: order.unitsMicros,
      leverage: input.leverage,
      status: 'filled',
      clientOrderId: input.clientOrderId,
      filledPrice: order.fill.toFixed(order.instrument.pricePrecision),
      notionalMicros: toMicros(plan.notional),
      feeMicros: plan.closeFeeMicros,
      positionId: freshPos.id,
      now,
    })
    const closed = executeClosePlan(ctx, repos, plan, created)
    const remainingUnits = order.units.minus(M(closedUnitsMicros))
    if (remainingUnits.lte(0)) {
      return { order: created, position: closed.position }
    }

    // Flip: open the remainder in the opposite direction in the same transaction.
    const remNotional = notionalFtk(remainingUnits, order.fill, order.q2u, ftkUsdRate(ctx))
    const remMargin = marginFor(remNotional, input.leverage)
    const remFee = calcOpenFee(remNotional, ctx.config.fees.takerBps, ctx.config.fees.minOpenFee)
    const opened = lockOpeningMargin(repos, {
      accountId: account.id,
      mode: input.mode,
      userId,
      symbol: input.symbol,
      side: input.side,
      leverage: input.leverage,
      maintenanceRatioBps: mmr,
      unitsMicros: toMicros(remainingUnits),
      entryPrice: order.fill.toFixed(order.instrument.pricePrecision),
      margin: remMargin,
      fee: remFee,
      refId: input.clientOrderId,
      memo: 'flip new position margin',
      now,
    })
    repos.trading.createFill({
      orderId: created.id,
      userId,
      accountId: account.id,
      positionId: opened.position.id,
      symbol: input.symbol,
      side: input.side,
      action: 'flip',
      unitsMicros: toMicros(remainingUnits),
      price: order.fill.toFixed(order.instrument.pricePrecision),
      notionalMicros: toMicros(remNotional),
      feeMicros: opened.feeMicros,
      realizedPnlMicros: 0n,
      now,
    })
    if (input.takeProfit || input.stopLoss) {
      applyTpSlToPosition(ctx, repos, opened.position.id, input.takeProfit, input.stopLoss)
    }
    return {
      order: repos.trading.findOrderById(created.id)!,
      position: repos.trading.findPositionById(opened.position.id)!,
    }
  })
}

export function applyTpSlToPosition(
  ctx: TradingContext,
  repos: typeof ctx.repos,
  positionId: string,
  takeProfit?: string,
  stopLoss?: string,
): void {
  const pos = repos.trading.findPositionById(positionId)
  if (!pos) throw new AppError('POSITION_NOT_FOUND')
  if (
    !validateTpSl(
      pos.side,
      dec(pos.entryPrice),
      takeProfit ? dec(takeProfit) : null,
      stopLoss ? dec(stopLoss) : null,
    )
  ) {
    throw new AppError('INVALID_TP_SL')
  }
  if (takeProfit) repos.trading.upsertTrigger(positionId, 'tp', takeProfit, ctx.clock.now())
  if (stopLoss) repos.trading.upsertTrigger(positionId, 'sl', stopLoss, ctx.clock.now())
}
