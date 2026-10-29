import { withdrawalSchema } from '@fx42/contracts'
import { createWithdrawal } from '@fx42/application'
import { apiHandler, parseBody } from '../../../utils/api'
import { enforceRate } from '../../../utils/rate-limit'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { withdrawalDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  enforceRate(`withdraw:${auth.userId}`, 20, 60_000)
  const input = await parseBody(event, withdrawalSchema)
  const withdrawal = createWithdrawal(ctx(), auth.userId, input)
  return { withdrawal: withdrawalDto(withdrawal) }
})
