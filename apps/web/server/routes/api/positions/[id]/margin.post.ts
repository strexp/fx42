import { positionMarginSchema } from '@fx42/contracts'
import { addRemoveMargin } from '@fx42/application'
import { apiHandler, parseBody } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx } from '../../../../utils/runtime'
import { positionDto } from '../../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const id = getRouterParam(event, 'id') ?? ''
  const input = await parseBody(event, positionMarginSchema)
  const position = addRemoveMargin(ctx(), auth.userId, id, input)
  return { position: positionDto(ctx(), position) }
})
