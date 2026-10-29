import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const all = getQuery(event).allDevices === 'true'
  if (all) {
    const version = ctx().repos.users.incrementSessionVersion(auth.userId)
    ctx().repos.runtime.audit({
      actorId: auth.userId,
      action: 'session.revoke_all',
      target: auth.userId,
      before: { sessionVersion: auth.user.sessionVersion },
      after: { sessionVersion: version },
      ip: null,
      now: Date.now(),
    })
  }
  await clearUserSession(event)
  return { ok: true }
})
