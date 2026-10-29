import { bindTokenSchema } from '@fx42/contracts'
import { bindScamToken } from '@fx42/application'
import { apiHandler, clientIp, parseBody } from '../../../utils/api'
import { enforceRate } from '../../../utils/rate-limit'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { scamAccountDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  enforceRate(`token-bind:${auth.userId}`, 20, 60_000)
  const { token } = await parseBody(event, bindTokenSchema)
  const result = await bindScamToken(ctx(), auth.userId, token, { ip: clientIp(event) })
  return {
    credential: {
      hint: result.credential.tokenHint,
      scamUsername: result.credential.scamUsername,
      status: result.credential.status,
    },
    accounts: result.accounts.map(scamAccountDto),
  }
})
