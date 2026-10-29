import { cancelWithdrawal } from '@fx42/application'
import { apiHandler } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx } from '../../../../utils/runtime'
import { withdrawalDto } from '../../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const w = cancelWithdrawal(ctx(), auth.userId, id)
  return { withdrawal: withdrawalDto(w) }
})
