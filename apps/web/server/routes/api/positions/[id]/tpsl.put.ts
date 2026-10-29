import { tpslSchema } from '@fx42/contracts'
import { setTpSl } from '@fx42/application'
import { apiHandler, parseBody } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx } from '../../../../utils/runtime'
import { positionDto } from '../../../../utils/dto'
import { nativePriceString } from '../../../../utils/market'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const input = await parseBody(event, tpslSchema)
  const position = setTpSl(ctx(), auth.userId, id, {
    takeProfit:
      input.takeProfit === undefined || input.takeProfit === null
        ? input.takeProfit
        : nativePriceString(ctx(), input.takeProfit),
    stopLoss:
      input.stopLoss === undefined || input.stopLoss === null
        ? input.stopLoss
        : nativePriceString(ctx(), input.stopLoss),
  })
  return { position: positionDto(ctx(), position) }
})
