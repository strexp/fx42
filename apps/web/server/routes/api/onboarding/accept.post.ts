import { onboardingAcceptSchema } from '@fx42/contracts'
import { acceptOnboarding } from '@fx42/application'
import { apiHandler, clientIp, parseBody } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { accountDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const input = await parseBody(event, onboardingAcceptSchema)
  const result = acceptOnboarding(ctx(), auth.userId, input.mode, {
    ip: clientIp(event),
    userAgent: getHeader(event, 'user-agent') ?? null,
  })
  return {
    defaultMode: result.user.defaultMode,
    accounts: result.accounts.map(accountDto),
  }
})
