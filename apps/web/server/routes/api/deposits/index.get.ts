import { apiHandler, modeFrom, parsePagination } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { depositDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const mode = modeFrom(getQuery(event).mode, auth.user.defaultMode)
  const { limit, offset } = parsePagination(event)
  const items = ctx()
    .repos.funding.listDeposits(auth.userId, mode, limit + 1, offset)
    .map(depositDto)
  const hasMore = items.length > limit
  return { items: items.slice(0, limit), nextCursor: hasMore ? String(offset + limit) : null }
})
