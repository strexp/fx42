import { AppError } from '@fx42/shared'
import { apiHandler } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx } from '../../../../utils/runtime'
import { marketTickerDto } from '../../../../utils/dto'

export default apiHandler(async (event) => {
  await requireUser(event)
  const symbol = getRouterParam(event, 'symbol') ?? ''
  const ticker = marketTickerDto(ctx(), symbol)
  if (!ticker) throw new AppError('SYMBOL_DISABLED')
  return ticker
})
