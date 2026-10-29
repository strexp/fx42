import {
  checkTriggers,
  notifyRiskLevels,
  scanPositionRisks,
  type AppContext,
} from '@fx42/application'
import type { JobWorker } from './jobs'
import type { Logger } from './logger'

export class RiskLoop {
  private fast: NodeJS.Timeout | null = null
  private triggers: NodeJS.Timeout | null = null
  private stopped = false

  constructor(
    private readonly ctx: AppContext,
    private readonly jobs: JobWorker,
    private readonly log: Logger,
  ) {}

  start(): void {
    this.fast = setInterval(() => this.scan(), 250)
    this.fast.unref?.()
    this.triggers = setInterval(() => this.checkTriggers(), 1000)
    this.triggers.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.fast) clearInterval(this.fast)
    if (this.triggers) clearInterval(this.triggers)
  }

  private scan(): void {
    if (this.stopped) return
    try {
      this.ctx.prices.refreshAges?.(this.ctx.clock.now())
      const actions = scanPositionRisks(this.ctx)
      notifyRiskLevels(this.ctx, actions)
      for (const action of actions) {
        if (action.kind === 'liquidation') {
          const dedupe = `liq:${action.positionId}:${action.version}`
          this.jobs.enqueue(
            'liquidation',
            { positionId: action.positionId, version: action.version },
            { dedupeKey: dedupe, priority: 1, maxAttempts: 30 },
          )
        } else if (action.kind === 'auto_close') {
          this.jobs.enqueue(
            'auto-close',
            { positionId: action.positionId, version: action.version },
            { dedupeKey: `auto:${action.positionId}:${action.version}`, priority: 2 },
          )
        }
      }
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'risk scan failed')
    }
  }

  private checkTriggers(): void {
    if (this.stopped) return
    try {
      const triggered = checkTriggers(this.ctx)
      if (triggered.length) this.log.info({ triggered }, 'TP/SL triggered')
    } catch (error) {
      this.log.error({ error: (error as Error).message }, 'trigger check failed')
    }
  }
}
