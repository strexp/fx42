import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { ctx } from '../../utils/runtime'
import { accountDto } from '../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  return ctx().repos.users.findAccountsByUser(auth.userId).map(accountDto)
})
