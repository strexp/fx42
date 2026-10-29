import type { UserMeDto } from '@fx42/contracts'

export default defineNuxtRouteMiddleware(async (to) => {
  const requestFetch = useRequestFetch()
  const me = useState<UserMeDto | null>('fx42-me', () => null)
  const loginPath = '/login'
  const onboardingPath = '/onboarding'

  if (!me.value) {
    try {
      me.value = await requestFetch<UserMeDto>('/api/me')
    } catch {
      me.value = null
    }
  }

  if (!me.value) {
    if (to.path === loginPath) return
    return navigateTo(`${loginPath}?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  if (to.path === loginPath) return navigateTo('/')

  const termsAccepted = me.value.user.termsAccepted
  if (!termsAccepted && to.path !== onboardingPath) {
    return navigateTo(onboardingPath)
  }
  if (termsAccepted && to.path === onboardingPath) {
    return navigateTo('/')
  }
})
