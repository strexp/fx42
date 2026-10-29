import { describe, expect, it } from 'vitest'
import { fromMicros, toMicros } from '../src/money'

describe('micros and BigInt boundaries', () => {
  it('converts exactly without Number', () => {
    expect(toMicros('1')).toBe(100_000_000n)
    expect(toMicros('0.00000001')).toBe(1n)
    expect(fromMicros(100_000_000n)).toBe('1')
    expect(fromMicros(1n)).toBe('0.00000001')
  })

  it('handles 1e16 and 1e18 micros without precision loss', () => {
    expect(toMicros('100000000')).toBe(10_000_000_000_000_000n)
    expect(fromMicros(10_000_000_000_000_000n)).toBe('100000000')
    expect(toMicros('10000000000')).toBe(1_000_000_000_000_000_000n)
    expect(fromMicros(1_000_000_000_000_000_000n)).toBe('10000000000')
  })

  it('rounds fees up and withdrawals down', () => {
    expect(toMicros('0.000000001', 'ceil')).toBe(1n)
    expect(toMicros('0.000000019', 'down')).toBe(1n)
    expect(fromMicros(1_234_567_890n, 4, false)).toBe('12.3456')
  })

  it('rejects int64 overflow', () => {
    expect(() => toMicros('100000000000')).toThrow()
  })
})
