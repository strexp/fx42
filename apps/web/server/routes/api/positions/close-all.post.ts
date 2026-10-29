import { closeAllSchema } from '@fx42/contracts'
import { closeAll } from '@fx42/application'
import { apiHandler, parseBody } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { ftkPriceForSymbol } from '../../../utils/market'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const input = await parseBody(event, closeAllSchema)
  const result = closeAll(ctx(), auth.userId, input.mode, { allowStale: input.allowStale })
  return {
    ...result,
    closed: result.closed.map((item) => ({
      ...item,
      closePrice: ftkPriceForSymbol(ctx(), item.symbol, item.closePrice),
    })),
  }
})
