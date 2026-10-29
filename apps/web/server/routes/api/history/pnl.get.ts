import { fromMicros } from '@fx42/shared'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const days = Math.min(365, Math.max(1, Number(getQuery(event).days ?? 30)))
  const since = Date.now() - days * 86_400_000
  const fills = ctx().repos.trading.listFillPnlSince(auth.userId, since)
  const financing = ctx().repos.trading.listFinancingChargesForUserSince(auth.userId, since)
  const byDay = new Map<string, { realized: bigint; financing: bigint }>()
  const key = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  for (const f of fills) {
    const d = key(f.createdAt)
    const entry = byDay.get(d) ?? { realized: 0n, financing: 0n }
    entry.realized += f.realizedPnlMicros
    byDay.set(d, entry)
  }
  for (const f of financing) {
    const d = key(f.chargeDate)
    const entry = byDay.get(d) ?? { realized: 0n, financing: 0n }
    entry.financing -= f.amountMicros
    byDay.set(d, entry)
  }
  const items = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, v]) => ({
      date,
      realizedPnl: fromMicros(v.realized),
      financing: fromMicros(v.financing),
      net: fromMicros(v.realized + v.financing),
    }))
  return { items }
})
