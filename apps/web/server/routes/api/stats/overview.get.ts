import { fromMicros } from '@fx42/shared'
import { apiHandler } from '../../../utils/api'
import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'

export default apiHandler(async (event) => {
  await requireUser(event)
  const since = Date.now() - 86_400_000
  const coverageRaw = ctx().repos.runtime.getFlag('reserve_coverage_ok')
  return {
    notional24h: fromMicros(ctx().repos.market.sumNotionalSince(since)),
    openPositions: ctx().repos.market.countOpenPositionsAll(),
    liquidations24h: ctx().repos.market.countLiquidationsSince(since),
    reserveCoverageOk: coverageRaw === null ? null : coverageRaw === '1',
    users: ctx().repos.market.countUsers(),
  }
})
