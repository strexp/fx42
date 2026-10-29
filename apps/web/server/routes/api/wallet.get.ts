import { apiHandler, modeFrom } from '../../utils/api'
import { requireUser } from '../../utils/auth'
import { ctx } from '../../utils/runtime'
import { walletDto } from '../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const mode = modeFrom(getQuery(event).mode, auth.user.defaultMode)
  return walletDto(ctx(), auth.userId, mode)
})
