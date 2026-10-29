import { runtime } from '../utils/runtime'

export default defineEventHandler((event) => {
  const rt = runtime()
  const health = rt.health()
  const prices = rt.ctx.prices.all()
  const ready = health.ok && health.feed.connected && prices.length > 0
  setResponseStatus(event, ready ? 200 : 503)
  return { ...health, ready, quotes: prices.length }
})
