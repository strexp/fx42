import Decimal from 'decimal.js'

export const MICROS_PER_UNIT = 100_000_000n
export const MICROS_DECIMALS = 8

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 })

export type Rounding = 'half-up' | 'ceil' | 'floor' | 'down'

const roundingMap: Record<Rounding, Decimal.Rounding> = {
  'half-up': Decimal.ROUND_HALF_UP,
  ceil: Decimal.ROUND_CEIL,
  floor: Decimal.ROUND_FLOOR,
  down: Decimal.ROUND_DOWN,
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

export function dec(value: string | number | bigint | Decimal): Decimal {
  if (value instanceof Decimal) return value
  if (typeof value === 'bigint') return new Decimal(value.toString())
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MoneyError(`Invalid number: ${value}`)
    return new Decimal(value)
  }
  const d = new Decimal(value)
  if (!d.isFinite()) throw new MoneyError(`Invalid decimal: ${value}`)
  return d
}

/** Convert a decimal amount into integer micros. Never goes through Number. */
export function toMicros(value: string | bigint | Decimal, rounding: Rounding = 'half-up'): bigint {
  const d = dec(value).mul(MICROS_PER_UNIT.toString()).toDecimalPlaces(0, roundingMap[rounding])
  if (!d.isFinite()) throw new MoneyError('Invalid micros conversion')
  if (d.abs().gt('9223372036854775807')) throw new MoneyError('Amount exceeds int64 micros')
  return BigInt(d.toFixed(0))
}

/** Convert integer micros to a fixed-scale decimal string. */
export function fromMicros(micros: bigint, scale = MICROS_DECIMALS, trim = true): string {
  const negative = micros < 0n
  const abs = negative ? -micros : micros
  const whole = abs / MICROS_PER_UNIT
  const fraction = (abs % MICROS_PER_UNIT).toString().padStart(MICROS_DECIMALS, '0')
  let out = `${whole.toString()}.${fraction}`
  out = trimToScale(out, scale)
  if (trim) out = trimZeros(out)
  return negative && out !== '0' ? `-${out}` : out
}

function trimToScale(value: string, scale: number): string {
  const [whole, fraction = ''] = value.split('.')
  if (scale <= 0) return whole
  return `${whole}.${fraction.slice(0, scale).padEnd(scale, '0')}`
}

function trimZeros(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '') || '0'
}

export function bps(x: number | string | Decimal): Decimal {
  return dec(x).div(10000)
}
