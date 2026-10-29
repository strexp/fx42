import { apiHandler } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { ctx } from '../../utils/runtime'
import { meDto } from '../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  return meDto(ctx(), auth.userId, auth.session)
})
