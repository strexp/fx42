import { runtime } from '../../../utils/runtime'

export default defineEventHandler(() => {
  return runtime()
    .ctx.config.auth.providers.filter((p) => p.enabled)
    .map((p) => ({ id: p.id, displayName: p.displayName, kind: p.kind }))
})
