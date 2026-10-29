import { describe, expect, it } from 'vitest'
import { orderRiskGate, type OrderRiskInput } from '../src'

const base: OrderRiskInput = {
  action: 'open',
  mode: 'virtual',
  userStatus: 'active',
  termsAccepted: true,
  hasActiveCredential: true,
  haltOpening: false,
  haltAll: false,
  weekendWindow: false,
  marketState: 'open',
  quoteAgeMs: 100,
  feedGapMs: 100,
  spreadSpike: false,
  confirmStale: false,
  symbolEnabled: true,
  leverage: 100,
  leverageTiers: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
  instrument: {
    symbol: 'EURUSD',
    description: 'EUR/USD',
    base: 'EUR',
    quote: 'USD',
    contractSize: '100000',
    pipSize: '0.0001',
    pricePrecision: 5,
    minLots: '0.01',
    lotStep: '0.01',
    maxLots: '100',
    maxNetExposureUsd: '1000000',
  },
  lotsValid: true,
  unitsValid: true,
  orderNotionalFtk: 1000000,
  minOrderNotionalFtk: 100,
  maxOrderNotionalFtk: 20000000,
  userNotionalFtk: 0,
  maxUserNotionalFtk: 100000000,
  positionCount: 0,
  maxPositionsPerUser: 20,
  orderSignedExposureUsd: 10000,
  netExposureUsd: 0,
  maxNetExposureUsd: 1000000,
  availableBalanceFtk: 1000000,
  requiredMarginFtk: 10000,
  requiredFeeFtk: 100,
  reserveCoverageOk: true,
  staleQuoteMs: 5000,
  haltQuoteMs: 15000,
  maxStaleCloseFeedGapMs: 60000,
  marketClosedPolicy: 'close-only',
  weekendLeverageOk: true,
}

describe('OrderRiskGate', () => {
  it('accepts a healthy market open', () => {
    expect(orderRiskGate(base)).toBeNull()
  })

  it('blocks opening on halt but allows closing', () => {
    expect(orderRiskGate({ ...base, haltOpening: true })).toBe('HALTED')
    expect(orderRiskGate({ ...base, haltOpening: true, action: 'close' })).toBeNull()
  })

  it('allows suspended users to reduce/close but not open', () => {
    expect(orderRiskGate({ ...base, userStatus: 'suspended' })).toBe('USER_SUSPENDED')
    expect(orderRiskGate({ ...base, userStatus: 'suspended', action: 'reduce' })).toBeNull()
  })

  it('requires an active token for real opening only', () => {
    expect(orderRiskGate({ ...base, mode: 'real', hasActiveCredential: false })).toBe(
      'TOKEN_REQUIRED',
    )
    expect(
      orderRiskGate({ ...base, mode: 'real', hasActiveCredential: false, action: 'close' }),
    ).toBeNull()
  })

  it('requires confirmStale for stale or closed-market closes', () => {
    expect(
      orderRiskGate({ ...base, action: 'close', marketState: 'closed', confirmStale: false }),
    ).toBe('MARKET_CLOSED')
    expect(
      orderRiskGate({ ...base, action: 'close', marketState: 'closed', confirmStale: true }),
    ).toBeNull()
    expect(orderRiskGate({ ...base, quoteAgeMs: 6000, action: 'close', confirmStale: false })).toBe(
      'MARKET_STALE',
    )
    expect(
      orderRiskGate({ ...base, quoteAgeMs: 6000, action: 'close', confirmStale: true }),
    ).toBeNull()
  })

  it('blocks stale closes when the feed gap is too large even with confirmation', () => {
    expect(orderRiskGate({ ...base, action: 'close', feedGapMs: 61000, confirmStale: true })).toBe(
      'STALE_CLOSE_BLOCKED',
    )
  })

  it('blocks opening in a weekend window', () => {
    expect(orderRiskGate({ ...base, weekendWindow: true })).toBe('WEEKEND_MARGIN')
    expect(orderRiskGate({ ...base, weekendWindow: true, action: 'close' })).toBeNull()
  })

  it('blocks exposure increases but permits reductions', () => {
    expect(orderRiskGate({ ...base, netExposureUsd: 990000, orderSignedExposureUsd: 20000 })).toBe(
      'EXPOSURE_LIMIT',
    )
    expect(
      orderRiskGate({
        ...base,
        action: 'reduce',
        netExposureUsd: 990000,
        orderSignedExposureUsd: -20000,
      }),
    ).toBeNull()
  })

  it('blocks opening without sufficient balance and for spread spikes', () => {
    expect(orderRiskGate({ ...base, availableBalanceFtk: 100 })).toBe('INSUFFICIENT_BALANCE')
    expect(orderRiskGate({ ...base, spreadSpike: true })).toBe('SPREAD_SPIKE')
  })

  it('treats a flip as an opening action for every opening gate', () => {
    expect(orderRiskGate({ ...base, action: 'flip', weekendWindow: true })).toBe('WEEKEND_MARGIN')
    expect(orderRiskGate({ ...base, action: 'flip', haltOpening: true })).toBe('HALTED')
    expect(orderRiskGate({ ...base, action: 'flip', spreadSpike: true })).toBe('SPREAD_SPIKE')
    expect(orderRiskGate({ ...base, action: 'flip', orderNotionalFtk: 50 })).toBe('ORDER_TOO_SMALL')
    expect(orderRiskGate({ ...base, action: 'flip', marketState: 'closed' })).toBe('MARKET_CLOSED')
    expect(
      orderRiskGate({ ...base, action: 'flip', mode: 'real', hasActiveCredential: false }),
    ).toBe('TOKEN_REQUIRED')
  })
})
