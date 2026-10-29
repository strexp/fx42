import { orderPreviewSchema } from '@fx42/contracts'
import { previewOrder } from '@fx42/application'
import { apiHandler, parseBody } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { previewDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const input = await parseBody(event, orderPreviewSchema)
  const preview = previewOrder(ctx(), auth.userId, {
    mode: input.mode,
    symbol: input.symbol,
    side: input.side,
    lots: input.lots,
    units: input.units,
    leverage: input.leverage,
    clientOrderId: 'preview',
  })
  return previewDto(ctx(), preview)
})
