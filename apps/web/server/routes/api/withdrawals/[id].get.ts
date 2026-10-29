import { AppError } from '@fx42/shared'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { withdrawalDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const w = ctx().repos.funding.findWithdrawalById(id)
  if (!w || w.userId !== auth.userId) throw new AppError('FORBIDDEN')
  return { withdrawal: withdrawalDto(w) }
})
