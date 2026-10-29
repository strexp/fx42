import { virtualDepositSchema } from '@fx42/contracts'
import { createVirtualDeposit } from '@fx42/application'
import { apiHandler, parseBody } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { depositDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const input = await parseBody(event, virtualDepositSchema)
  const deposit = createVirtualDeposit(ctx(), auth.userId, input)
  return { deposit: depositDto(deposit) }
})
