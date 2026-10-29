import { setPrimaryAccountSchema } from '@fx42/contracts'
import { AppError } from '@fx42/shared'
import { apiHandler, parseBody } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx } from '../../../../utils/runtime'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const input = await parseBody(event, setPrimaryAccountSchema)
  const ok = ctx().repos.credentials.setPrimaryScamAccount(auth.userId, input.accountId)
  if (!ok) throw new AppError('DESTINATION_FORBIDDEN')
  return { ok: true }
})
