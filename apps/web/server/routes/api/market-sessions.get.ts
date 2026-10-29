import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'

const ZONES = [
  { name: 'Sydney', zone: 'Australia/Sydney' },
  { name: 'Tokyo', zone: 'Asia/Tokyo' },
  { name: 'London', zone: 'Europe/London' },
  { name: 'NewYork', zone: 'America/New_York' },
]

function stateAt(zone: string, ms: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekday = get('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') return false
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  return minutes >= 8 * 60 && minutes < 17 * 60
}

function transition(zone: string, from: number, desired: boolean): number | null {
  const step = 5 * 60_000
  for (let t = from + step; t < from + 7 * 86_400_000; t += step) {
    if (stateAt(zone, t) === desired) return t
  }
  return null
}

export default apiHandler(async (event) => {
  await requireUser(event)
  const now = Date.now()
  return ZONES.map(({ name, zone }) => {
    const open = stateAt(zone, now)
    const next = transition(zone, now, !open)
    return {
      name,
      timezone: zone,
      open,
      opensAt: open ? null : next ? new Date(next).toISOString() : null,
      closesAt: open ? (next ? new Date(next).toISOString() : null) : null,
    }
  })
})
