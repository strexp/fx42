import { isWeekendWindow } from '@fx42/application'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx, runtime } from '../../../utils/runtime'

export default apiHandler(async (event) => {
  await requireUser(event)
  const feed = ctx().repos.market.getFeedStatus()
  const coverage = ctx().repos.runtime.getFlag('reserve_coverage_ok')
  return {
    mode: runtime().env.FX42_MODE,
    haltOpening: ctx().repos.runtime.getFlag('halt_opening') === '1',
    haltAll: ctx().repos.runtime.getFlag('halt_all') === '1',
    feedConnected: feed.connected,
    lastTickAt: feed.lastTickAt,
    weekend: isWeekendWindow(ctx().config, Date.now()),
    reserveCoverageOk: coverage === null ? null : coverage === '1',
  }
})
