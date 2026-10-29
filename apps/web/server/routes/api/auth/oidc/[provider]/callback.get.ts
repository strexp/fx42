import { loginWithOidc } from '@fx42/application'
import { AppError } from '@fx42/shared'
import { ctx, runtime } from '../../../../../utils/runtime'
import { takeState } from '../../../../../utils/oidc-state'

const STATE_COOKIE = 'fx42_oidc_state'

function safeRedirect(value: string | null): string {
  if (value && value.startsWith('/') && !value.startsWith('//')) return value
  return '/'
}

export default defineEventHandler(async (event) => {
  const providerId = getRouterParam(event, 'provider') ?? ''
  const rt = runtime()
  const provider = rt.ctx.config.auth.providers.find((p) => p.id === providerId)
  if (!provider) throw createError({ statusCode: 404, statusMessage: 'OIDC_PROVIDER_UNKNOWN' })
  if (!provider.enabled)
    throw createError({ statusCode: 403, statusMessage: 'OIDC_PROVIDER_DISABLED' })

  const key = getCookie(event, STATE_COOKIE)
  deleteCookie(event, STATE_COOKIE, { path: '/' })
  if (!key) throw new AppError('OIDC_STATE_INVALID')
  const state = takeState(key)
  if (!state || state.providerId !== provider.id) throw new AppError('OIDC_STATE_INVALID')

  const baseUrl = rt.env.NUXT_PUBLIC_BASE_URL.replace(/\/$/, '')
  const currentUrl = `${baseUrl}${event.path}`
  let claims
  try {
    const completed = await rt.oidc.complete(provider.id, currentUrl, state)
    claims = completed.claims
  } catch (error) {
    console.error('OIDC callback failed', error)
    return sendRedirect(event, `/login?error=${encodeURIComponent('OIDC callback failed')}`)
  }

  try {
    const result = loginWithOidc(ctx(), {
      providerId: provider.id,
      kind: provider.kind,
      subject: claims.sub,
      name: claims.name,
      preferredUsername: claims.preferredUsername,
      email: claims.email,
      activeMnt: claims.activeMnt,
      activeName: claims.activeName,
    })
    await setUserSession(event, {
      userId: result.user.id,
      identityId: result.identity.id,
      providerId: result.identity.providerId,
      sessionVersion: result.user.sessionVersion,
      loggedInAt: Date.now(),
    })
    return sendRedirect(
      event,
      result.user.onboardingCompletedAt ? safeRedirect(state.redirectTo) : '/onboarding',
    )
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'OIDC_STATE_INVALID'
    return sendRedirect(event, `/login?error=${encodeURIComponent(code)}`)
  }
})
