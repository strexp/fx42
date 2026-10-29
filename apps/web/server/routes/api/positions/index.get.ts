import { apiHandler, modeFrom } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { accountSnapshotDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const mode = modeFrom(getQuery(event).mode, auth.user.defaultMode)
  const snapshot = accountSnapshotDto(ctx(), auth.userId, mode)
  return { items: snapshot.positions, wallet: snapshot.wallet }
})
