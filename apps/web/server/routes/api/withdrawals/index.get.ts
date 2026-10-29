import { apiHandler, modeFrom, parsePagination } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { withdrawalDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const mode = modeFrom(getQuery(event).mode, auth.user.defaultMode)
  const { limit, offset } = parsePagination(event)
  const rows = ctx()
    .repos.funding.listWithdrawals(auth.userId, mode, limit + 1, offset)
    .map(withdrawalDto)
  const hasMore = rows.length > limit
  return { items: rows.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null }
})
