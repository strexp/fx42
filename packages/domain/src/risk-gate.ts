import type { Side, Mode, InstrumentConfig } from './math'
import type { ErrorCode } from '@fx42/shared'

export type OrderAction = 'open' | 'increase' | 'reduce' | 'close' | 'flip'
export type UserStatus = 'active' | 'suspended' | 'closed'

/** Margin-ratio bands shared by the risk loop and the UI. */
export const RISK_RATIO_THRESHOLDS = {
  marginCall: '1.15',
  danger: '1.50',
  warning: '2.00',
} as const

/** Auto-close must stay below the current ratio so the next scan cannot trigger instantly. */
export const AUTO_CLOSE_SAFETY_RATIO = '0.9'

export interface OrderRiskInput {
  action: OrderAction
  mode: Mode
  userStatus: UserStatus
  termsAccepted: boolean
  hasActiveCredential: boolean
  haltOpening: boolean
  haltAll: boolean
  weekendWindow: boolean
  marketState: 'open' | 'closed'
  quoteAgeMs: number
  feedGapMs: number
  spreadSpike: boolean
  confirmStale: boolean
  symbolEnabled: boolean
  leverage: number
  leverageTiers: number[]
  instrument: InstrumentConfig
  lotsValid: boolean
  unitsValid: boolean
  orderNotionalFtk: number
  minOrderNotionalFtk: number
  maxOrderNotionalFtk: number
  userNotionalFtk: number
  maxUserNotionalFtk: number
  positionCount: number
  maxPositionsPerUser: number
  orderSignedExposureUsd: number
  netExposureUsd: number
  maxNetExposureUsd: number
  availableBalanceFtk: number
  requiredMarginFtk: number
  requiredFeeFtk: number
  reserveCoverageOk: boolean
  staleQuoteMs: number
  haltQuoteMs: number
  maxStaleCloseFeedGapMs: number
  marketClosedPolicy: 'allow' | 'close-only' | 'block'
  weekendLeverageOk: boolean
}

/**
 * Single authoritative trading gate. Returns the first failing error code.
 * Reduce/close paths intentionally bypass the opening checks (status, terms,
 * token, halt, weekend, exposure, position count and balance). A flip is an
 * opening action: only its closing leg is exempt.
 */
export function orderRiskGate(input: OrderRiskInput): ErrorCode | null {
  const reducing = input.action === 'reduce' || input.action === 'close'

  // 1. account / status / terms
  if (input.userStatus === 'closed' && !reducing) return 'USER_SUSPENDED'
  if (input.userStatus === 'suspended' && !reducing) return 'USER_SUSPENDED'
  if (!input.termsAccepted && !reducing) return 'TERMS_REQUIRED'

  // 2. real token gate
  if (input.mode === 'real' && !reducing && !input.hasActiveCredential) return 'TOKEN_REQUIRED'

  // 3. halts
  if (input.haltAll && !reducing) return 'HALTED'
  if (input.haltOpening && !reducing) return 'HALTED'

  // 4. weekend window
  if (input.weekendWindow && !reducing) return 'WEEKEND_MARGIN'

  // 5. symbol / leverage / size
  if (!input.symbolEnabled) return 'SYMBOL_DISABLED'
  if (!input.leverageTiers.includes(input.leverage)) return 'INVALID_LEVERAGE'
  if (!input.lotsValid) return 'INVALID_LOTS'
  if (!input.unitsValid) return 'INVALID_UNITS'
  if (!reducing) {
    if (input.orderNotionalFtk < input.minOrderNotionalFtk) return 'ORDER_TOO_SMALL'
    if (input.orderNotionalFtk > input.maxOrderNotionalFtk) return 'ORDER_TOO_LARGE'
  }

  // 6. market state / stale quote
  if (reducing) {
    if (input.marketState === 'closed') {
      if (input.marketClosedPolicy === 'block') return 'MARKET_CLOSED'
      if (!input.confirmStale) return 'MARKET_CLOSED'
    }
    if (input.quoteAgeMs > input.staleQuoteMs && !input.confirmStale) return 'MARKET_STALE'
    if (input.feedGapMs > input.maxStaleCloseFeedGapMs) return 'STALE_CLOSE_BLOCKED'
  } else {
    if (input.marketState === 'closed') return 'MARKET_CLOSED'
    if (input.quoteAgeMs > input.staleQuoteMs) return 'MARKET_STALE'
    if (input.feedGapMs > input.haltQuoteMs) return 'MARKET_HALTED'
  }

  // 7. spread spike
  if (!reducing && input.spreadSpike) return 'SPREAD_SPIKE'

  // 8. exposure / position count / user notional
  if (!reducing) {
    const newExposure = input.netExposureUsd + input.orderSignedExposureUsd
    if (
      Math.abs(newExposure) > input.maxNetExposureUsd &&
      Math.abs(newExposure) > Math.abs(input.netExposureUsd)
    ) {
      return 'EXPOSURE_LIMIT'
    }
    if (input.positionCount >= input.maxPositionsPerUser) return 'POSITION_LIMIT'
    if (input.userNotionalFtk + input.orderNotionalFtk > input.maxUserNotionalFtk) {
      return 'EXPOSURE_LIMIT'
    }
    if (input.weekendWindow && !input.weekendLeverageOk) return 'WEEKEND_MARGIN'
  }

  // 9. balance / margin / reserve
  if (!reducing) {
    if (!input.reserveCoverageOk) return 'RESERVE_INSUFFICIENT'
    const required = input.requiredMarginFtk + input.requiredFeeFtk
    if (input.availableBalanceFtk < required) return 'INSUFFICIENT_BALANCE'
  }

  return null
}

export type { Side, Mode, InstrumentConfig }
