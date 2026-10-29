import { apiHandler, modeFrom, parsePagination } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { orderDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const mode = modeFrom(getQuery(event).mode, auth.user.defaultMode)
  const account = ctx().repos.users.findAccountByUserMode(auth.userId, mode)
  if (!account) return { items: [], nextCursor: null }
  const { limit, offset } = parsePagination(event)
  const status =
    typeof getQuery(event).status === 'string' ? String(getQuery(event).status) : undefined
  const rows = ctx()
    .repos.trading.listOrders(account.id, limit + 1, offset, status)
    .map((order) => orderDto(ctx(), order))
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? String(offset + limit) : null,
  }
})
