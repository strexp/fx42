import type { H3Event } from 'h3'
import { AppError } from '@fx42/shared'
import { ctx } from './runtime'

export async function currentSession(event: H3Event) {
  const session = await getUserSession(event)
  if (!session?.userId) throw new AppError('UNAUTHORIZED')
  return session
}

export async function requireUser(event: H3Event) {
  const session = await currentSession(event)
  const user = ctx().repos.users.findUserById(session.userId)
  if (!user) throw new AppError('SESSION_INVALID')
  if (user.status === 'closed') throw new AppError('USER_SUSPENDED')
  if (user.sessionVersion !== session.sessionVersion) throw new AppError('SESSION_INVALID')
  const identity = session.identityId
    ? ctx().repos.users.findIdentityById(session.identityId)
    : null
  return {
    session,
    user,
    identity,
    userId: user.id,
  }
}

export async function requireOnboarded(event: H3Event) {
  const auth = await requireUser(event)
  if (!auth.user.onboardingCompletedAt) throw new AppError('ONBOARDING_REQUIRED')
  return auth
}
