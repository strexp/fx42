import { fromMicros } from '@fx42/shared'
import { apiHandler, parsePagination } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { ftkPriceForSymbol } from '../../../utils/market'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const { limit, offset } = parsePagination(event)
  const rows = ctx().repos.trading.listFills(auth.userId, limit + 1, offset)
  return {
    items: rows.slice(0, limit).map((f) => ({
      id: f.id,
      symbol: f.symbol,
      side: f.side,
      action: f.action,
      units: fromMicros(f.unitsMicros),
      price: ftkPriceForSymbol(ctx(), f.symbol, f.price),
      notional: fromMicros(f.notionalMicros),
      fee: fromMicros(f.feeMicros),
      realizedPnl: fromMicros(f.realizedPnlMicros),
      createdAt: new Date(f.createdAt).toISOString(),
    })),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  }
})
