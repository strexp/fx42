import { apiHandler } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx } from '../../../../utils/runtime'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const changed = ctx().repos.runtime.markNotificationsRead(auth.userId, Date.now())
  return { changed }
})
