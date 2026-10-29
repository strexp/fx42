export default defineEventHandler((event) => {
  const method = event.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return
  if (process.env.NODE_ENV !== 'production') return
  const hasSession = Boolean(getCookie(event, 'nuxt-session'))
  const origin = getHeader(event, 'origin')
  const host = getHeader(event, 'host')
  if (!origin) {
    // CLI/curl writes carry no browser Origin and no session cookie. Browser
    // writes with a session must include Origin (CSRF defence in depth).
    if (hasSession) throw createError({ statusCode: 403, statusMessage: 'FORBIDDEN' })
    return
  }
  try {
    const originHost = new URL(origin).host
    if (host && originHost !== host) throw createError({ statusCode: 403, statusMessage: 'FORBIDDEN' })
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 403) throw error
    throw createError({ statusCode: 403, statusMessage: 'FORBIDDEN' })
  }
})
