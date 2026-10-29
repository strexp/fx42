import type { NotificationKind } from '@fx42/contracts'

import { apiHandler, parsePagination } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { ftkPriceForSymbol } from '../../../utils/market'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const { limit } = parsePagination(event)
  const items = ctx()
    .repos.runtime.listNotifications(auth.userId, limit)
    .map((n) => {
      const payload = JSON.parse(n.payload) as Record<string, unknown>
      if (typeof payload.closePrice === 'string' && typeof payload.symbol === 'string') {
        payload.closePrice = ftkPriceForSymbol(ctx(), payload.symbol, payload.closePrice)
      }
      return {
        id: n.id,
        kind: n.kind as NotificationKind,
        payload,
        readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
        createdAt: new Date(n.createdAt).toISOString(),
      }
    })
  return { items }
})
