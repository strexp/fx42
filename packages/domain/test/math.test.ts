import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import {
  calcLiquidationPrice,
  effectiveMaxLots,
  fillPrice,
  instrumentDirection,
  normalizeUsdBaseCandle,
  normalizeUsdBasePrice,
  marginFor,
  normalizedPipSize,
  notionalFtk,
  openFee,
  positionMetrics,
  quoteToUsdAt,
  realizedPnl,
  settleClose,
  validateLeverageTiers,
  validateLots,
  weekendMinMargin,
  withdrawalPreview,
  type InstrumentConfig,
  type FeeConfig,
} from '../src'

const eurusd: InstrumentConfig = {
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
}
const usdjpy: InstrumentConfig = {
  ...eurusd,
  symbol: 'USDJPY',
  base: 'USD',
  quote: 'JPY',
  pipSize: '0.01',
  pricePrecision: 3,
  description: 'USD/JPY',
}
const fees: FeeConfig = {
  takerBps: 1,
  minOpenFee: '0.1',
  spreadMarkupBps: 0,
  depositBps: 0,
  withdrawFixed: '0.1',
  withdrawBps: 10,
}

describe('domain math', () => {
  it('EURUSD long: notional, margin, fee and PnL match hand calculation', () => {
    const notional = notionalFtk(
      new Decimal(100000),
      new Decimal('1.11500'),
      new Decimal(1),
      new Decimal('0.01'),
    )
    expect(notional.toString()).toBe('11150000')
    expect(marginFor(notional, 100).toString()).toBe('111500')
    expect(openFee(notional, 1).toString()).toBe('1115')
    expect(openFee(new Decimal(1), 1, '0.1').toString()).toBe('0.1')
    const pnl = realizedPnl(
      'long',
      new Decimal('1.11500'),
      new Decimal('1.11700'),
      new Decimal(100000),
      new Decimal(1),
      new Decimal('0.01'),
    )
    expect(pnl.toString()).toBe('20000')
  })

  it('normalizes USD-base instruments at the ingestion boundary', () => {
    expect(instrumentDirection({ symbol: 'USDJPY' })).toEqual({
      base: 'JPY',
      quote: 'USD',
    })
    expect(normalizeUsdBasePrice(new Decimal(157), 6)).toBe('0.006369')
    expect(
      normalizeUsdBaseCandle({ open: '157', high: '158', low: '156', close: '157.5' }, 6),
    ).toEqual({
      open: '0.006369',
      high: '0.006410',
      low: '0.006329',
      close: '0.006349',
    })
  })

  it('derives the normalized pip for base=USD instruments from the current price', () => {
    const eurPip = normalizedPipSize({ symbol: 'EURUSD', pipSize: '0.0001' }, '1.115')
    expect(eurPip.toString()).toBe('0.0001')
    const jpyPip = normalizedPipSize({ symbol: 'USDJPY', pipSize: '0.01' }, '0.006369')
    expect(jpyPip.mul(1e7).toFixed(4)).toBe('4.0564')
  })

  it('USDJPY short uses the exit quoteToUsd', () => {
    const q2u = quoteToUsdAt(usdjpy, new Decimal('156'))
    const pnl = realizedPnl(
      'short',
      new Decimal('157.000'),
      new Decimal('156.000'),
      new Decimal(100000),
      q2u,
      new Decimal('0.01'),
    )
    expect(Number(pnl.toFixed(2))).toBeCloseTo(64102.56, 2)
  })

  it('computes liquidation price below entry for long and above entry for short', () => {
    const longLiq = calcLiquidationPrice(
      {
        side: 'long',
        entryPrice: '1.11500',
        units: '100000',
        margin: '111500',
        maintenanceRatioBps: 50,
      },
      eurusd,
      new Decimal('0.01'),
    )
    expect(longLiq).not.toBeNull()
    expect(longLiq!.lt('1.11500')).toBe(true)
    const shortLiq = calcLiquidationPrice(
      {
        side: 'short',
        entryPrice: '1.11500',
        units: '100000',
        margin: '111500',
        maintenanceRatioBps: 50,
      },
      eurusd,
      new Decimal('0.01'),
    )
    expect(shortLiq).not.toBeNull()
    expect(shortLiq!.gt('1.11500')).toBe(true)
  })

  it('liquidation price gets closer to entry at higher leverage', () => {
    const low = calcLiquidationPrice(
      {
        side: 'long',
        entryPrice: '1.11500',
        units: '100000',
        margin: '223000',
        maintenanceRatioBps: 100,
      },
      eurusd,
      new Decimal('0.01'),
    )!
    const high = calcLiquidationPrice(
      {
        side: 'long',
        entryPrice: '1.11500',
        units: '100000',
        margin: '1115',
        maintenanceRatioBps: 5,
      },
      eurusd,
      new Decimal('0.01'),
    )!
    expect(high.gt(low)).toBe(true)
  })

  it('position metrics are consistent with maintenance ratio', () => {
    const metrics = positionMetrics(
      {
        side: 'long',
        entryPrice: '1.11500',
        units: '100000',
        margin: '111500',
        maintenanceRatioBps: 50,
      },
      new Decimal('1.11700'),
      eurusd,
      new Decimal('0.01'),
    )
    expect(metrics.unrealizedPnl.toString()).toBe('20000')
    expect(metrics.notional.toString()).toBe('11170000')
    expect(metrics.marginRatio.gt(1)).toBe(true)
  })

  it('settles a profitable close and a deficit close with insurance and bad debt', () => {
    const profit = settleClose({
      margin: new Decimal(1000),
      realized: new Decimal(100),
      notional: new Decimal(100000),
      liquidationFeeBps: 100,
      insuranceBalance: new Decimal(0),
      forcedLiquidation: false,
    })
    expect(profit.userCredit.toString()).toBe('1100')
    const deficit = settleClose({
      margin: new Decimal(1000),
      realized: new Decimal(-1500),
      notional: new Decimal(100000),
      liquidationFeeBps: 100,
      insuranceBalance: new Decimal(100),
      forcedLiquidation: true,
    })
    expect(deficit.penalty.toString()).toBe('0')
    expect(deficit.insuranceDelta.toString()).toBe('-100')
    expect(deficit.badDebtDelta.toString()).toBe('-400')
  })

  it('rounds withdrawal net down to 4 decimals and absorbs the fee difference', () => {
    const preview = withdrawalPreview(new Decimal('50'), fees)!
    expect(preview.net.toString()).toBe('49.85')
    expect(preview.fee.toString()).toBe('0.15')
    expect(preview.netMicros).toBe(4985000000n)
    expect(preview.feeMicros + preview.netMicros).toBe(preview.amountMicros)
  })

  it('validates lot steps with integer ticks', () => {
    expect(validateLots(new Decimal('0.01'), eurusd).ok).toBe(true)
    expect(validateLots(new Decimal('0.015'), eurusd).ok).toBe(false)
    expect(validateLots(new Decimal('101'), eurusd).ok).toBe(false)
  })

  it('caps effective max lots by order notional', () => {
    const max = effectiveMaxLots(
      eurusd,
      new Decimal('1.115'),
      new Decimal('0.01'),
      new Decimal(20000000),
    )
    expect(max.lte(100)).toBe(true)
    expect(max.gt(1)).toBe(true)
  })

  it('checks leverage/MMR safety constraints', () => {
    expect(
      validateLeverageTiers(
        [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
        { 1: 1000, 2: 200, 5: 200, 10: 100, 20: 100, 50: 100, 100: 50, 200: 30, 500: 10, 1000: 5 },
        1,
        2,
      ),
    ).toHaveLength(0)
  })

  it('computes weekend minimum margin at 50x', () => {
    expect(weekendMinMargin(new Decimal(100000), 50).toString()).toBe('2000')
  })

  it('fill price uses ask for long and bid for short with markup', () => {
    expect(fillPrice(new Decimal('1.1'), new Decimal('1.2'), 'long', 0).toString()).toBe('1.2')
    expect(fillPrice(new Decimal('1.1'), new Decimal('1.2'), 'short', 0).toString()).toBe('1.1')
    expect(fillPrice(new Decimal('1.1'), new Decimal('1.2'), 'long', 100).toString()).toBe('1.212')
  })

  it('base=USD instruments derive quoteToUsd from price', () => {
    expect(quoteToUsdAt(usdjpy, new Decimal('160')).toString()).toBe('0.00625')
  })
})
