import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { marketTickerDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  await requireUser(event)
  const items = ctx()
    .config.instruments.filter((i) => i.enabled)
    .map((i) => marketTickerDto(ctx(), i.symbol))
    .filter((x): x is NonNullable<typeof x> => !!x)
  return items
})
