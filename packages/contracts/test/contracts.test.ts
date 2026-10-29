import { describe, expect, it } from 'vitest'
import {
  orderSchema,
  orderPreviewSchema,
  withdrawalSchema,
  onboardingAcceptSchema,
  candlesQuerySchema,
} from '../src'

describe('API contracts', () => {
  const order = {
    mode: 'virtual',
    symbol: 'EURUSD',
    side: 'long',
    lots: '1',
    leverage: 100,
    type: 'market',
    clientOrderId: '01JTESTORDER123',
  }

  it('accepts a v1 market order with lots', () => {
    expect(orderSchema.parse(order).lots).toBe('1')
  })

  it('normalizes numeric JSON amounts to decimal strings for permissive clients', () => {
    const parsed = orderSchema.parse({ ...order, lots: 1 })
    expect(parsed.lots).toBe('1')
    expect(typeof parsed.lots).toBe('string')
  })

  it('rejects limit/stop orders in v1', () => {
    expect(() => orderSchema.parse({ ...order, type: 'limit' })).toThrow()
    expect(() => orderSchema.parse({ ...order, type: 'stop' })).toThrow()
  })

  it('requires exactly one of lots or units', () => {
    expect(() => orderSchema.parse({ ...order, lots: undefined, units: undefined })).toThrow()
    expect(() => orderSchema.parse({ ...order, units: '1000' })).toThrow()
  })

  it('rejects invalid leverage and negative amounts', () => {
    expect(() => orderSchema.parse({ ...order, leverage: 0 })).toThrow()
    expect(() => orderSchema.parse({ ...order, lots: '-1' })).toThrow()
  })

  it('discriminates real vs virtual withdrawals', () => {
    const real = withdrawalSchema.parse({
      mode: 'real',
      amount: '10',
      destinationAccountId: 'acc',
      requestId: 'req-12345678',
    })
    expect(real.mode).toBe('real')
    const virtual = withdrawalSchema.parse({
      mode: 'virtual',
      amount: '10',
      requestId: 'req-12345678',
    })
    expect(virtual.mode).toBe('virtual')
    expect(() =>
      withdrawalSchema.parse({ mode: 'real', amount: '10', requestId: 'req-12345678' }),
    ).toThrow()
  })

  it('validates onboarding mode and candle intervals', () => {
    expect(onboardingAcceptSchema.parse({ mode: 'virtual' }).mode).toBe('virtual')
    expect(candlesQuerySchema.parse({ interval: '1h', limit: '300' }).limit).toBe(300)
    expect(() => candlesQuerySchema.parse({ interval: '2h' })).toThrow()
  })

  it('keeps previews free of client order ids', () => {
    const preview = orderPreviewSchema.parse({
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      units: '1000',
      leverage: 20,
    })
    expect(preview.units).toBe('1000')
  })
})
