import { closePositionSchema } from '@fx42/contracts'
import { closePosition } from '@fx42/application'
import { apiHandler, parseBody } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx } from '../../../../utils/runtime'
import { orderDto, positionDto } from '../../../../utils/dto'
import { ftkPriceForSymbol } from '../../../../utils/market'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const input = await parseBody(event, closePositionSchema)
  const result = closePosition(ctx(), auth.userId, id, {
    units: input.units,
    confirmStale: input.confirmStale,
    reason: 'manual',
    clientOrderId: input.clientOrderId,
  })
  return {
    order: orderDto(ctx(), result.order),
    position: result.position ? positionDto(ctx(), result.position) : null,
    closePrice: ftkPriceForSymbol(ctx(), result.order.symbol, result.closePrice),
    realized: result.realized,
    closedUnits: result.closedUnits,
    remainingUnits: result.remainingUnits,
    fullyClosed: result.fullyClosed,
  }
})
