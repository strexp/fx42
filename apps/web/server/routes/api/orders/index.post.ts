import { orderSchema } from '@fx42/contracts'
import { placeOrder } from '@fx42/application'
import { apiHandler, parseBody } from '../../../utils/api'
import { enforceRate } from '../../../utils/rate-limit'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { orderDto, positionDto } from '../../../utils/dto'
import { nativePriceString } from '../../../utils/market'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  enforceRate(`order:${auth.userId}`, 30, 1000)
  const input = await parseBody(event, orderSchema)
  const result = placeOrder(ctx(), auth.userId, {
    mode: input.mode,
    symbol: input.symbol,
    side: input.side,
    lots: input.lots,
    units: input.units,
    leverage: input.leverage,
    clientOrderId: input.clientOrderId,
    takeProfit:
      input.takeProfit === undefined ? undefined : nativePriceString(ctx(), input.takeProfit),
    stopLoss: input.stopLoss === undefined ? undefined : nativePriceString(ctx(), input.stopLoss),
    confirmStale: input.confirmStale,
  })
  return {
    order: orderDto(ctx(), result.order),
    position: result.position ? positionDto(ctx(), result.position) : null,
  }
})
