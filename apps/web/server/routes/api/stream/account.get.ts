import { modeFrom } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { accountSnapshotDto } from '../../../utils/dto'
import { ctx } from '../../../utils/runtime'
import { streamSse } from '../../../utils/sse'

export default defineEventHandler(async (event) => {
  let auth
  try {
    auth = await requireUser(event)
  } catch {
    setResponseStatus(event, 401)
    return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }
  }

  const query = getQuery(event)
  const mode = modeFrom(query.mode, auth.user.defaultMode)
  const refreshMs = Math.min(10_000, Math.max(500, Number(query.interval ?? 1000) || 1000))

  return streamSse(event, {
    intervalMs: refreshMs,
    send: (sse) => sse.send('snapshot', accountSnapshotDto(ctx(), auth.userId, mode)),
  })
})
