import { AppError } from '@fx42/shared'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { orderDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const order = ctx().repos.trading.findOrderById(id)
  if (!order || order.userId !== auth.userId) throw new AppError('FORBIDDEN')
  return { order: orderDto(ctx(), order) }
})
