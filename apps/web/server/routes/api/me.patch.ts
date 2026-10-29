import { profileUpdateSchema } from '@fx42/contracts'
import { updateProfile } from '@fx42/application'
import { apiHandler, parseBody } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { ctx } from '../../utils/runtime'
import { meDto } from '../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const input = await parseBody(event, profileUpdateSchema)
  updateProfile(ctx(), auth.userId, input)
  return meDto(ctx(), auth.userId, auth.session)
})
