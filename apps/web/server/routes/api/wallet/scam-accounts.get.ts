import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { scamAccountDto } from '../../../utils/dto'

export default apiHandler(async (event) => {
  const auth = await requireUser(event)
  const credential = ctx().repos.credentials.findLiveCredential(auth.userId)
  if (!credential) return { credential: null, accounts: [] }
  const accounts = ctx()
    .repos.credentials.listScamAccounts(credential.id)
    .filter((account) => account.iban !== ctx().reserve.iban)
    .map(scamAccountDto)
  return {
    credential: {
      hint: credential.tokenHint,
      scamUsername: credential.scamUsername,
      status: credential.status,
    },
    accounts,
  }
})
