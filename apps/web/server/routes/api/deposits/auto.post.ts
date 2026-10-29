import { autoDepositSchema } from '@fx42/contracts'
import { createAutoDeposit } from '@fx42/application'
import { apiHandler, parseBody } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { enforceRate } from '../../../utils/rate-limit'
import { ctx } from '../../../utils/runtime'
import { depositDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  enforceRate(`deposit:${auth.userId}`, 20, 60_000)
  const input = await parseBody(event, autoDepositSchema)
  const deposit = await createAutoDeposit(ctx(), auth.userId, input)
  return { deposit: depositDto(deposit) }
})
