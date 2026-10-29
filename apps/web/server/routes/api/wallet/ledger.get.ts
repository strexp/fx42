import { fromMicros } from '@fx42/shared'
import { apiHandler, modeFrom, parsePagination } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const mode = modeFrom(getQuery(event).mode, auth.user.defaultMode)
  const account = ctx().repos.users.findAccountByUserMode(auth.userId, mode)
  if (!account) return { items: [], nextCursor: null }
  const { limit, offset } = parsePagination(event)
  const rows = ctx().repos.wallets.listWalletLedger(account.id, mode, limit + 1, offset)
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map((r) => ({
    amount: fromMicros(r.amountMicros),
    balanceAfter: fromMicros(r.balanceAfterMicros),
    createdAt: new Date(r.createdAt).toISOString(),
    type: r.type,
    refType: r.refType,
    refId: r.refId,
    memo: r.memo,
  }))
  return { items, nextCursor: hasMore ? String(offset + limit) : null }
})
