import Decimal from 'decimal.js'
import { dec, toMicros, bps } from '@fx42/shared'

export type Side = 'long' | 'short'
export type Mode = 'real' | 'virtual'

export interface InstrumentConfig {
  symbol: string
  description: string
  base: string
  quote: string
  contractSize: string
  pipSize: string
  pricePrecision: number
  minLots: string
  lotStep: string
  maxLots: string
  maxNetExposureUsd: string
}

export interface FeeConfig {
  takerBps: number
  minOpenFee: string
  spreadMarkupBps: number
  depositBps: number
  withdrawFixed: string
  withdrawBps: number
}

export interface PositionLike {
  side: Side
  units: Decimal | string
  entryPrice: Decimal | string
  margin: Decimal | string
  maintenanceRatioBps: number
}

const SUFFIX = /_(HKN|OTC|PRO)$/

export function parseSymbol(raw: string): { base: string; quote: string } | null {
  const symbol = raw.replace(SUFFIX, '')
  if (!/^[A-Z]{6}$/.test(symbol)) return null
  return { base: symbol.slice(0, 3), quote: symbol.slice(3) }
}

export function instrumentDirection(
  instrument: Pick<InstrumentConfig, 'symbol'>,
): { base: string; quote: string } | null {
  const parsed = parseSymbol(instrument.symbol)
  if (!parsed) return null
  // Enabled markets are presented in FTK; the engine stores USD per unit of
  // the foreign currency. USD-base symbols are therefore normalized to
  // <foreign currency>/USD at ingestion; no per-instrument switch is exposed
  // to configuration or the UI.
  return parsed.base === 'USD' ? { base: parsed.quote, quote: parsed.base } : parsed
}

export function isUsdBaseInstrument(instrument: Pick<InstrumentConfig, 'symbol'>): boolean {
  return parseSymbol(instrument.symbol)?.base === 'USD'
}

export function isSingleUsdInstrument(instrument: InstrumentConfig): boolean {
  return instrument.quote === 'USD' || instrument.base === 'USD'
}

/**
 * Pip size in the normalized (foreign/USD) price space.
 *
 * USD-base instruments are quoted as S = USD/XXX by the venue, but the
 * platform stores and trades P = 1/S. A native pip p therefore becomes
 * p / S² = p × P² in the normalized space. Keeping the native pip in the
 * config and converting here means the value stays correct as S moves.
 */
export function normalizedPipSize(
  instrument: Pick<InstrumentConfig, 'symbol' | 'pipSize'>,
  price: Decimal.Value,
): Decimal {
  const pip = dec(instrument.pipSize)
  if (!isUsdBaseInstrument(instrument)) return pip
  const normalized = dec(price)
  if (normalized.lte(0)) return pip
  return pip.mul(normalized.pow(2))
}

/** Convert a native USD/XXX price to the normalized XXX/USD price. */
export function normalizeUsdBasePrice(value: Decimal.Value, precision: number): string {
  return new Decimal(1).div(value).toFixed(precision)
}

export function normalizeUsdBaseCandle(
  candle: { open: string; high: string; low: string; close: string },
  precision: number,
): { open: string; high: string; low: string; close: string } {
  return {
    open: normalizeUsdBasePrice(candle.open, precision),
    high: normalizeUsdBasePrice(candle.low, precision),
    low: normalizeUsdBasePrice(candle.high, precision),
    close: normalizeUsdBasePrice(candle.close, precision),
  }
}

/**
 * USD value of one unit of the quote currency at a given instrument price.
 * Enabled instruments are normalized to quote=USD, where this is 1. The
 * base=USD branch remains as a fallback for unnormalized inputs.
 */
export function quoteToUsdAt(instrument: InstrumentConfig, price: Decimal): Decimal {
  if (instrument.quote === 'USD') return new Decimal(1)
  if (instrument.base === 'USD') return new Decimal(1).div(price)
  throw new Error(`Unsupported instrument ${instrument.symbol}: cross pairs are not enabled in v1`)
}

export function notionalFtk(
  units: Decimal,
  price: Decimal,
  quoteToUsd: Decimal,
  ftkUsdRate: Decimal,
): Decimal {
  return units.mul(price).mul(quoteToUsd).div(ftkUsdRate)
}

export function fillPrice(
  bid: Decimal,
  ask: Decimal,
  side: Side,
  spreadMarkupBps: number,
): Decimal {
  const markup = bps(spreadMarkupBps)
  return side === 'long'
    ? ask.mul(new Decimal(1).plus(markup))
    : bid.mul(new Decimal(1).minus(markup))
}

export function openFee(notional: Decimal, feeBps: number, minFee: Decimal.Value = 0): Decimal {
  return Decimal.max(notional.mul(bps(feeBps)), new Decimal(minFee))
}

export function marginFor(notional: Decimal, leverage: number): Decimal {
  return notional.div(leverage)
}

export function unrealizedPnl(
  pos: PositionLike,
  mark: Decimal,
  quoteToUsd: Decimal,
  ftkUsdRate: Decimal,
): Decimal {
  const diff = pos.side === 'long' ? mark.minus(pos.entryPrice) : dec(pos.entryPrice).minus(mark)
  return diff.mul(dec(pos.units)).mul(quoteToUsd).div(ftkUsdRate)
}

export function realizedPnl(
  side: Side,
  entry: Decimal,
  exit: Decimal,
  units: Decimal,
  quoteToUsd: Decimal,
  ftkUsdRate: Decimal,
): Decimal {
  const diff = side === 'long' ? exit.minus(entry) : entry.minus(exit)
  return diff.mul(units).mul(quoteToUsd).div(ftkUsdRate)
}

export function weightedEntry(
  oldEntry: Decimal,
  oldUnits: Decimal,
  fill: Decimal,
  addUnits: Decimal,
): Decimal {
  return oldEntry.mul(oldUnits).plus(fill.mul(addUnits)).div(oldUnits.plus(addUnits))
}

export function maintenanceMargin(notional: Decimal, maintenanceRatioBps: number): Decimal {
  return notional.mul(bps(maintenanceRatioBps))
}

export function positionEquity(margin: Decimal, pnl: Decimal): Decimal {
  return margin.plus(pnl)
}

export function marginRatio(equity: Decimal, maintenance: Decimal): Decimal {
  if (maintenance.lte(0)) return new Decimal(Number.POSITIVE_INFINITY)
  return equity.div(maintenance)
}

export interface PositionMetrics {
  mark: Decimal
  quoteToUsd: Decimal
  notional: Decimal
  unrealizedPnl: Decimal
  equity: Decimal
  maintenance: Decimal
  marginRatio: Decimal
}

export function positionMetrics(
  pos: PositionLike,
  mark: Decimal,
  instrument: InstrumentConfig,
  ftkUsdRate: Decimal,
): PositionMetrics {
  const q2u = quoteToUsdAt(instrument, mark)
  const units = dec(pos.units)
  const notional = notionalFtk(units, mark, q2u, ftkUsdRate)
  const pnl = unrealizedPnl(pos, mark, q2u, ftkUsdRate)
  const equity = positionEquity(dec(pos.margin), pnl)
  const maintenance = maintenanceMargin(notional, pos.maintenanceRatioBps)
  return {
    mark,
    quoteToUsd: q2u,
    notional,
    unrealizedPnl: pnl,
    equity,
    maintenance,
    marginRatio: marginRatio(equity, maintenance),
  }
}

/**
 * Numeric liquidation price solver. 80 iterations of bisection is plenty for
 * 18-digit inputs; the caller is responsible for rounding to the instrument's
 * price precision.
 */
export function calcLiquidationPrice(
  pos: PositionLike,
  instrument: InstrumentConfig,
  ftkUsdRate: Decimal,
): Decimal | null {
  const entry = dec(pos.entryPrice)
  const maintenanceBps = pos.maintenanceRatioBps
  const margin = dec(pos.margin)
  const units = dec(pos.units)
  if (units.lte(0) || margin.lte(0)) return null

  const safe = (price: Decimal): boolean => {
    const q2u = quoteToUsdAt(instrument, price)
    const notional = notionalFtk(units, price, q2u, ftkUsdRate)
    const pnl = unrealizedPnl(pos, price, q2u, ftkUsdRate)
    return margin.plus(pnl).gt(maintenanceMargin(notional, maintenanceBps))
  }

  if (pos.side === 'long') {
    let lo = new Decimal(0)
    let hi = entry
    if (safe(lo)) return null
    // expand upwards until safe (max 64 doublings)
    for (let i = 0; i < 64 && !safe(hi); i++) hi = hi.mul(2)
    if (!safe(hi)) return null
    for (let i = 0; i < 80; i++) {
      const mid = lo.plus(hi).div(2)
      if (safe(mid)) hi = mid
      else lo = mid
    }
    return lo
  }

  let lo = entry
  let hi = entry.mul(2)
  // low prices are safe for shorts; expand high until unsafe
  for (let i = 0; i < 64 && safe(hi); i++) hi = hi.mul(2)
  if (safe(hi)) return null
  for (let i = 0; i < 80; i++) {
    const mid = lo.plus(hi).div(2)
    if (safe(mid)) lo = mid
    else hi = mid
  }
  return hi
}

export function roundPriceConservative(price: Decimal, precision: number, side: Side): Decimal {
  return price.toDecimalPlaces(precision, side === 'long' ? Decimal.ROUND_DOWN : Decimal.ROUND_UP)
}

export function validateLots(
  lots: Decimal,
  instrument: InstrumentConfig,
): { ok: true; units: Decimal } | { ok: false; code: 'INVALID_LOTS'; reason: string } {
  const min = new Decimal(instrument.minLots)
  const step = new Decimal(instrument.lotStep)
  const max = new Decimal(instrument.maxLots)
  if (lots.lt(min)) return { ok: false, code: 'INVALID_LOTS', reason: 'below minLots' }
  if (lots.gt(max)) return { ok: false, code: 'INVALID_LOTS', reason: 'above maxLots' }
  const ticks = lots.minus(min).div(step)
  if (!ticks.isInteger())
    return { ok: false, code: 'INVALID_LOTS', reason: 'not aligned to lotStep' }
  return { ok: true, units: lots.mul(instrument.contractSize) }
}

export function unitsToLots(units: Decimal, instrument: InstrumentConfig): Decimal {
  return units.div(instrument.contractSize)
}

export function effectiveMaxLots(
  instrument: InstrumentConfig,
  price: Decimal,
  ftkUsdRate: Decimal,
  maxOrderNotionalFtk: Decimal,
): Decimal {
  const q2u = quoteToUsdAt(instrument, price)
  const notionalPerLot = new Decimal(instrument.contractSize).mul(price).mul(q2u).div(ftkUsdRate)
  if (notionalPerLot.lte(0)) return new Decimal(0)
  const byNotional = maxOrderNotionalFtk.div(notionalPerLot)
  const max = new Decimal(instrument.maxLots)
  const step = new Decimal(instrument.lotStep)
  const capped = Decimal.min(byNotional, max)
  // floor to lot step grid relative to zero (lots are positive here)
  if (step.lte(0)) return capped
  const ticks = capped.div(step).floor()
  return ticks.mul(step)
}

export interface SettlementInput {
  margin: Decimal
  realized: Decimal
  notional: Decimal
  liquidationFeeBps: number
  insuranceBalance: Decimal
  forcedLiquidation: boolean
}

export interface SettlementResult {
  equity: Decimal
  penalty: Decimal
  userCredit: Decimal
  insuranceDelta: Decimal
  badDebtDelta: Decimal
  deficit: Decimal
}

/**
 * Unified close settlement. All amounts are FTK/VFTK (not micros).
 * E = margin + realized.
 */
export function settleClose(input: SettlementInput): SettlementResult {
  const equity = input.margin.plus(input.realized)
  if (equity.gte(0)) {
    const rawPenalty = input.forcedLiquidation
      ? input.notional.mul(bps(input.liquidationFeeBps))
      : new Decimal(0)
    const penalty = Decimal.min(rawPenalty, equity)
    return {
      equity,
      penalty,
      userCredit: equity.minus(penalty),
      insuranceDelta: penalty,
      badDebtDelta: new Decimal(0),
      deficit: new Decimal(0),
    }
  }
  const deficit = equity.neg()
  const absorbed = Decimal.min(deficit, Decimal.max(input.insuranceBalance, 0))
  return {
    equity,
    penalty: new Decimal(0),
    userCredit: new Decimal(0),
    insuranceDelta: absorbed.neg(),
    badDebtDelta: deficit.minus(absorbed).neg(),
    deficit,
  }
}

export interface WithdrawalPreview {
  fee: Decimal
  net: Decimal
  feeMicros: bigint
  netMicros: bigint
  amountMicros: bigint
}

export function withdrawalPreview(amount: Decimal, fees: FeeConfig): WithdrawalPreview | null {
  const fixed = new Decimal(fees.withdrawFixed)
  const rawFee = fixed.plus(amount.mul(bps(fees.withdrawBps)))
  const net0 = amount.minus(rawFee)
  if (net0.lt(new Decimal('0.01'))) return null
  const net = net0.toDecimalPlaces(4, Decimal.ROUND_DOWN)
  if (net.lt(new Decimal('0.01'))) return null
  const actualFee = amount.minus(net)
  return {
    fee: actualFee,
    net,
    feeMicros: toMicros(actualFee, 'ceil'),
    netMicros: toMicros(net, 'down'),
    amountMicros: toMicros(amount, 'down'),
  }
}

export function financingFee(notional: Decimal, annualRateBps: number): Decimal {
  return notional.mul(bps(annualRateBps)).div(365)
}

export function weekendMinMargin(notional: Decimal, weekendMaxLeverage: number): Decimal {
  return notional.div(weekendMaxLeverage)
}

export function autoCloseRatioToBps(ratio: Decimal): number {
  return ratio.mul(10000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
}

export function validateLeverageTiers(
  tiers: number[],
  maintenanceByLeverage: Record<number, number>,
  takerBps: number,
  gapBufferBps: number,
): string[] {
  const errors: string[] = []
  if (tiers.length === 0) errors.push('leverageTiers must not be empty')
  for (const leverage of tiers) {
    if (!Number.isInteger(leverage) || leverage < 1) {
      errors.push(`invalid leverage tier ${leverage}`)
      continue
    }
    const mmr = maintenanceByLeverage[leverage]
    if (mmr === undefined) {
      errors.push(`missing maintenance margin for ${leverage}x`)
      continue
    }
    const lhs = new Decimal(1).div(leverage)
    const rhs = new Decimal(mmr)
      .plus(takerBps * 2)
      .plus(gapBufferBps)
      .div(10000)
    if (!lhs.gt(rhs)) {
      errors.push(
        `leverage ${leverage}x too risky: 1/leverage (${lhs.toString()}) <= mmr+2*taker+gap (${rhs.toString()})`,
      )
    }
  }
  return errors
}

export function validateTpSl(
  side: Side,
  entry: Decimal,
  takeProfit: Decimal | null,
  stopLoss: Decimal | null,
): boolean {
  if (takeProfit) {
    if (side === 'long' ? !takeProfit.gt(entry) : !takeProfit.lt(entry)) return false
  }
  if (stopLoss) {
    if (side === 'long' ? !stopLoss.lt(entry) : !stopLoss.gt(entry)) return false
  }
  return true
}
