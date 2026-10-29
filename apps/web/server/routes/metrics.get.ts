import { runtime } from '../utils/runtime'

export default defineEventHandler(async (event) => {
  const rt = runtime()
  const token = getHeader(event, 'authorization')?.replace(/^Bearer\s+/i, '') ?? String(getQuery(event).token ?? '')
  if (rt.env.NODE_ENV === 'production' && token !== rt.env.METRICS_TOKEN) {
    setResponseStatus(event, 401)
    return 'unauthorized'
  }
  setHeader(event, 'content-type', rt.registry.contentType)
  return rt.registry.metrics()
})
