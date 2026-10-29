import { AppError } from '@fx42/shared'
import { normaliseMnt } from '@fx42/config'
import { displayNameFor } from './helpers'
import type { AccountContext } from './ports'
import type { AccountRow, IdentityRow, UserRow } from '@fx42/db'

export interface OidcLoginInput {
  providerId: string
  kind: 'dn42' | 'generic'
  subject: string
  name?: string
  preferredUsername?: string
  email?: string
  activeMnt?: string
  activeName?: string
  locale?: 'zh-CN' | 'en'
}

export interface OidcLoginResult {
  user: UserRow
  identity: IdentityRow
  createdUser: boolean
}

export function loginWithOidc(ctx: AccountContext, input: OidcLoginInput): OidcLoginResult {
  const now = ctx.clock.now()
  const displayName = displayNameFor({
    name: input.name,
    preferredUsername: input.preferredUsername,
    activeName: input.activeName,
    activeMnt: input.activeMnt,
    email: input.email,
  })
  const email = input.email ?? null

  if (input.kind === 'dn42') {
    if (!input.activeMnt) throw new AppError('OIDC_CLAIM_MISSING')
    const mnt = normaliseMnt(input.activeMnt)
    let user = ctx.repos.users.findUserByMnt(mnt)
    let createdUser = false
    if (!user) {
      user = ctx.repos.users.createUser({
        activeMnt: mnt,
        displayName,
        email,
        locale: input.locale ?? 'en',
        now,
      })
      createdUser = true
    } else {
      ctx.repos.users.updateUserLogin(user.id, { displayName, email, now })
      user = ctx.repos.users.findUserById(user.id)!
    }
    let identity = ctx.repos.users.findIdentity(input.providerId, input.subject)
    if (!identity) {
      identity = ctx.repos.users.createIdentity({
        userId: user.id,
        providerId: input.providerId,
        providerKind: 'dn42',
        subject: input.subject,
        activeMnt: mnt,
        email,
        now,
      })
    } else {
      if (identity.userId !== user.id) {
        throw new AppError('OIDC_IDENTITY_MISMATCH', {
          message: 'identity belongs to another account',
        })
      }
      ctx.repos.users.touchIdentity(identity.id, mnt, now)
      identity = ctx.repos.users.findIdentityById(identity.id)!
    }
    return { user: ctx.repos.users.findUserById(user.id)!, identity, createdUser }
  }

  if (!input.subject) throw new AppError('OIDC_SUB_MISSING')
  let identity = ctx.repos.users.findIdentity(input.providerId, input.subject)
  let createdUser = false
  let user: UserRow
  if (!identity) {
    user = ctx.repos.users.createUser({
      activeMnt: null,
      displayName,
      email,
      locale: input.locale ?? 'en',
      now,
    })
    createdUser = true
    identity = ctx.repos.users.createIdentity({
      userId: user.id,
      providerId: input.providerId,
      providerKind: 'generic',
      subject: input.subject,
      activeMnt: null,
      email,
      now,
    })
  } else {
    const foundUser = ctx.repos.users.findUserById(identity.userId)
    if (!foundUser) throw new AppError('INTERNAL', { message: 'identity has no user' })
    user = foundUser
    ctx.repos.users.updateUserLogin(user.id, { displayName, email, now })
    ctx.repos.users.touchIdentity(identity.id, null, now)
    user = ctx.repos.users.findUserById(user.id)!
    identity = ctx.repos.users.findIdentityById(identity.id)!
  }
  return { user, identity, createdUser }
}

export function acceptOnboarding(
  ctx: AccountContext,
  userId: string,
  mode: 'real' | 'virtual',
  meta: { ip: string | null; userAgent: string | null },
): { user: UserRow; accounts: AccountRow[] } {
  const now = ctx.clock.now()
  return ctx.uow.run(() => acceptOnboardingInner(ctx, userId, mode, meta, now))
}

function acceptOnboardingInner(
  ctx: AccountContext,
  userId: string,
  mode: 'real' | 'virtual',
  meta: { ip: string | null; userAgent: string | null },
  now: number,
): { user: UserRow; accounts: AccountRow[] } {
  const user = ctx.repos.users.findUserById(userId)
  if (!user) throw new AppError('UNAUTHORIZED')
  ctx.repos.users.createTerms(userId, mode, meta.ip, meta.userAgent, now)
  for (const m of ['real', 'virtual'] as const) {
    if (!ctx.repos.users.findAccountByUserMode(userId, m))
      ctx.repos.users.createAccount(userId, m, now)
  }
  ctx.repos.users.completeOnboarding(userId, mode, now)
  ctx.repos.runtime.audit({
    actorId: userId,
    action: 'terms.accept',
    target: userId,
    before: null,
    after: { mode },
    ip: meta.ip,
    now,
  })
  return {
    user: ctx.repos.users.findUserById(userId)!,
    accounts: ctx.repos.users.findAccountsByUser(userId),
  }
}

export function updateProfile(
  ctx: AccountContext,
  userId: string,
  input: { displayName?: string; locale?: 'zh-CN' | 'en'; defaultMode?: 'real' | 'virtual' },
): UserRow {
  return ctx.repos.users.updateUserProfile(userId, input)
}
