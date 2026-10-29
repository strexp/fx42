import { mockClaimsFor } from '@fx42/clients'
import { loginWithOidc } from '@fx42/application'

import { ctx, runtime } from '../../../../utils/runtime'
import { saveState } from '../../../../utils/oidc-state'
import { clientIp, requestId } from '../../../../utils/api'
import { enforceRate } from '../../../../utils/rate-limit'

const STATE_COOKIE = 'fx42_oidc_state'

function safeRedirect(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value
  return '/'
}

export default defineEventHandler(async (event) => {
  const providerId = getRouterParam(event, 'provider') ?? ''
  enforceRate(`login:${clientIp(event) ?? 'unknown'}`, 60, 60_000)
  const rt = runtime()
  const provider = rt.ctx.config.auth.providers.find((p) => p.id === providerId)
  if (!provider) throw createError({ statusCode: 404, statusMessage: 'OIDC_PROVIDER_UNKNOWN' })
  if (!provider.enabled)
    throw createError({ statusCode: 403, statusMessage: 'OIDC_PROVIDER_DISABLED' })

  const redirectTo = safeRedirect(getQuery(event).redirect)

  if (rt.env.FX42_MODE === 'mock') {
    const claims = mockClaimsFor(provider.id, provider.kind)
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
    const target = result.user.onboardingCompletedAt ? redirectTo : '/onboarding'
    return sendRedirect(event, target)
  }

  const baseUrl = rt.env.NUXT_PUBLIC_BASE_URL
  try {
    const { url, state } = await rt.oidc.begin(provider.id, baseUrl, redirectTo)
    const key = saveState(state)
    setCookie(event, STATE_COOKIE, key, {
      httpOnly: true,
      sameSite: 'lax',
      secure: rt.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    })
    return sendRedirect(event, url)
  } catch (error) {
    console.error(`[${requestId()}] OIDC begin failed`, error)
    return sendRedirect(event, `/login?error=${encodeURIComponent((error as Error).message)}`)
  }
})
