import { AppError } from '@fx42/shared'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { depositDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const deposit = ctx().repos.funding.findDepositById(id)
  if (!deposit || deposit.userId !== auth.userId) throw new AppError('FORBIDDEN')
  return { deposit: depositDto(deposit) }
})
