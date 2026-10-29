import { unbindScamToken } from '@fx42/application'
import { apiHandler, clientIp } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  unbindScamToken(ctx(), auth.userId, { ip: clientIp(event) })
  return { ok: true }
})
