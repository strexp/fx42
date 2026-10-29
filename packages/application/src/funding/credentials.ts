import { AppError, toMicros } from '@fx42/shared'
import { getUser, requireTerms } from '../helpers'
import type { FundingContext } from '../ports'
import { ScamError } from '../ports'
import type { CredentialRow, ScamAccountRow } from '@fx42/db'

/**
 * The reserve account is a system account configured exclusively through
 * environment variables. It is not linked to any user and no credential row
 * is created for it.
 */
export function reserveConfig(ctx: FundingContext): { iban: string; token: string } {
  const { iban, token } = ctx.reserve
  if (!iban || !token) {
    throw new AppError('RESERVE_INSUFFICIENT', {
      message: 'SCAM_RESERVE_IBAN and SCAM_RESERVE_TOKEN must be configured',
    })
  }
  return { iban, token }
}

export async function resolveReserveAccount(
  ctx: FundingContext,
): Promise<{ iban: string; token: string; scamAccountId: number }> {
  const { iban, token } = reserveConfig(ctx)
  if (ctx.reserve.scamAccountId !== null) {
    return { iban, token, scamAccountId: ctx.reserve.scamAccountId }
  }

  let remote
  try {
    remote = await ctx.scam.listAccounts(token)
  } catch (error) {
    if (error instanceof ScamError && (error.status === 401 || error.status === 403)) {
      throw new AppError('RESERVE_INSUFFICIENT', { message: 'reserve token is invalid' })
    }
    if (error instanceof ScamError) throw error
    throw new AppError('SCAM_UNAVAILABLE', { message: 'reserve account lookup failed' })
  }
  const account = remote.accounts.find((candidate) => candidate.iban === iban)
  if (!account) {
    throw new AppError('RESERVE_INSUFFICIENT', {
      message: 'reserve token does not have access to SCAM_RESERVE_IBAN',
    })
  }
  ctx.reserve.scamAccountId = account.scamAccountId
  return { iban, token, scamAccountId: account.scamAccountId }
}

export async function bindScamToken(
  ctx: FundingContext,
  userId: string,
  token: string,
  meta: { ip: string | null },
): Promise<{ credential: CredentialRow; accounts: ScamAccountRow[] }> {
  requireTerms(ctx.repos, userId)
  let remote
  try {
    remote = await ctx.scam.listAccounts(token)
  } catch (error) {
    if (error instanceof ScamError && error.status === 401) throw new AppError('TOKEN_INVALID')
    if (error instanceof ScamError && error.status === 403) throw new AppError('TOKEN_INVALID')
    throw new AppError('SCAM_UNAVAILABLE')
  }
  if (!remote.accounts.length) throw new AppError('TOKEN_INVALID', { message: 'No scam accounts' })
  if (ctx.reserve.iban && remote.accounts.some((account) => account.iban === ctx.reserve.iban)) {
    throw new AppError('REBIND_BLOCKED', {
      message: 'the reserve account cannot be bound to a user',
    })
  }

  const user = getUser(ctx, userId)
  if (user.status !== 'active') throw new AppError('USER_SUSPENDED')
  const live = ctx.repos.credentials.findLiveCredential(userId)
  if (live) {
    const hasPositions = ctx.repos.trading.hasOpenPositions(userId)
    const realAccount = ctx.repos.users.findAccountByUserMode(userId, 'real')
    const virtualAccount = ctx.repos.users.findAccountByUserMode(userId, 'virtual')
    const realWallet = realAccount ? ctx.repos.wallets.findUserWallet(realAccount.id) : null
    const virtualWallet = virtualAccount
      ? ctx.repos.wallets.findUserWallet(virtualAccount.id)
      : null
    const hasBalance =
      (realWallet?.balanceMicros ?? 0n) > 0n || (virtualWallet?.balanceMicros ?? 0n) > 0n
    if (hasPositions || hasBalance || ctx.repos.trading.hasPendingFunding(userId)) {
      throw new AppError('REBIND_BLOCKED', {
        details: {
          hasPositions,
          hasBalance,
          hasPendingFunding: ctx.repos.trading.hasPendingFunding(userId),
        },
      })
    }
  }

  const encrypted = ctx.crypto.encrypt(token)
  const hint = ctx.crypto.hint(token)
  const now = ctx.clock.now()
  const uow = ctx.uow
  const credentialId = uow.run((repos) => {
    let credential: CredentialRow
    if (live) {
      repos.credentials.updateCredential(live.id, {
        tokenCipher: encrypted.cipher,
        tokenHint: hint,
        scamUserId: remote.userId,
        scamUsername: remote.username,
        status: 'active',
        now,
      })
      credential = repos.credentials.findCredentialById(live.id)!
    } else {
      credential = repos.credentials.createCredential({
        userId,
        tokenCipher: encrypted.cipher,
        tokenHint: hint,
        scamUserId: remote.userId,
        scamUsername: remote.username,
        status: 'active',
        now,
      })
    }
    const accounts = remote.accounts.map((a) => ({
      scamAccountId: a.scamAccountId,
      iban: a.iban,
      accountName: a.accountName,
      balanceMicros: toMicros(a.balance),
    }))
    let primary =
      credential.id === live?.id
        ? (repos.credentials.findPrimaryScamAccount(credential.id)?.scamAccountId ?? null)
        : null
    repos.credentials.replaceScamAccounts(credential.id, accounts, primary, now)
    repos.runtime.audit({
      actorId: userId,
      action: 'token.bind',
      target: credential.id,
      before: live ? { hint: live.tokenHint } : null,
      after: { hint },
      ip: meta.ip,
      now,
    })
    return credential.id
  })

  const credential = ctx.repos.credentials.findCredentialById(credentialId)!
  return {
    credential,
    accounts: ctx.repos.credentials
      .listScamAccounts(credentialId)
      .filter((account) => account.iban !== ctx.reserve.iban),
  }
}

export function unbindScamToken(
  ctx: FundingContext,
  userId: string,
  meta: { ip: string | null },
): void {
  const live = ctx.repos.credentials.findLiveCredential(userId)
  if (!live) throw new AppError('TOKEN_REQUIRED')
  if (ctx.repos.trading.hasOpenPositions(userId))
    throw new AppError('REBIND_BLOCKED', { details: { reason: 'positions' } })
  if (ctx.repos.trading.hasPendingFunding(userId))
    throw new AppError('REBIND_BLOCKED', { details: { reason: 'pending_funding' } })
  const realAccount = ctx.repos.users.findAccountByUserMode(userId, 'real')
  const wallet = realAccount ? ctx.repos.wallets.findUserWallet(realAccount.id) : null
  if ((wallet?.balanceMicros ?? 0n) > 0n)
    throw new AppError('REBIND_BLOCKED', { details: { reason: 'balance' } })
  const now = ctx.clock.now()
  ctx.uow.run((repos) => {
    repos.credentials.setCredentialStatus(live.id, 'revoked', now)
    repos.runtime.audit({
      actorId: userId,
      action: 'token.unbind',
      target: live.id,
      before: { hint: live.tokenHint },
      after: null,
      ip: meta.ip,
      now,
    })
  })
}
