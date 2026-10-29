export interface Clock {
  now(): number
}

export const systemClock: Clock = { now: () => Date.now() }

export const DAY_MS = 86_400_000

export const CANDLE_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const
export type CandleInterval = (typeof CANDLE_INTERVALS)[number]

export const INTERVAL_MS: Record<CandleInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': DAY_MS,
}

export function utcDayStart(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Current weekday/minute in the FX market's reference timezone. */
export function newYorkClock(now: number): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    weekday: get('weekday'),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

export function fixedClock(ms: number): Clock {
  let current = ms
  return {
    now: () => current,
    // test helper
    set: (next: number) => {
      current = next
    },
  } as Clock & { set: (next: number) => void }
}
