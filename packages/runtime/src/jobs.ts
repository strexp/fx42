import { AppError, utcDayStart, type JobPayloads, type JobType } from '@fx42/shared'
import {
  applyFinancing,
  autoClosePosition,
  enforceWeekendMargins,
  executeWithdrawal,
  failWithdrawal,
  liquidatePosition,
  monitorReserve,
  recalcRisk,
  reconcileWithdrawals,
  reviewWeekendMargins,
  syncDeposits,
  type AppContext,
} from '@fx42/application'
import { ScamError } from '@fx42/application'
import type { JobRow } from '@fx42/db'
import { reconcile as reconcileLedger } from '@fx42/db'
import type { Metrics } from './metrics'
import type { Logger } from './logger'

export interface JobWorkerOptions {
  ctx: AppContext
  log: Logger
  metrics?: Metrics
}

export class JobWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private stopped = false
  private lastCleanup = 0

  constructor(private readonly options: JobWorkerOptions) {}

  start(): void {
    const { ctx } = this.options
    ctx.repos.jobs.resetStaleJobs(ctx.clock.now())
    this.timer = setInterval(() => void this.loop(), 500)
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  enqueue<T extends JobType>(
    type: T,
    payload: JobPayloads[T],
    options: {
      dedupeKey?: string | null
      delayMs?: number
      priority?: number
      maxAttempts?: number
    } = {},
  ): string | null {
    const now = this.options.ctx.clock.now()
    return this.options.ctx.repos.jobs.enqueueJob({
      type,
      payload,
      dedupeKey: options.dedupeKey ?? null,
      runAt: now + (options.delayMs ?? 0),
      priority: options.priority ?? 100,
      maxAttempts: options.maxAttempts ?? 3,
      now,
    })
  }

  private async loop(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      const { ctx } = this.options
      ctx.prices.refreshAges?.(ctx.clock.now())
      for (let i = 0; i < 10; i++) {
        const job = ctx.repos.jobs.claimJob(ctx.clock.now())
        if (!job) break
        await this.run(job)
      }
      this.options.metrics?.jobsPending.set(ctx.repos.jobs.countJobs('pending'))
      if (ctx.clock.now() - this.lastCleanup > 6 * 60 * 60 * 1000) {
        this.lastCleanup = ctx.clock.now()
        this.enqueue('cleanup', {}, { dedupeKey: 'cleanup:6h', delayMs: 1000, priority: 500 })
      }
    } catch (error) {
      this.options.log.error({ error: (error as Error).message }, 'job loop failed')
    } finally {
      this.running = false
    }
  }

  private async run(job: JobRow): Promise<void> {
    const { ctx } = this.options
    const log = this.options.log
    try {
      const payload = JSON.parse(job.payload) as Record<string, unknown>
      switch (job.type as JobType) {
        case 'liquidation': {
          const liquidation = payload as JobPayloads['liquidation']
          const result = liquidatePosition(
            ctx,
            String(liquidation.positionId),
            Number(liquidation.version),
          )
          if (!result.liquidated) {
            if (result.reason === 'stale' || result.reason === 'market_closed') {
              ctx.repos.jobs.finishJob(job.id, ctx.clock.now())
              this.enqueue('liquidation', liquidation, {
                dedupeKey: `${liquidation.positionId}:${liquidation.version}`,
                delayMs: 1000,
                priority: 1,
                maxAttempts: 30,
              })
              return
            }
          } else {
            this.options.metrics?.liquidationsTotal.inc({ result: 'ok' })
          }
          break
        }
        case 'auto-close': {
          const autoClose = payload as JobPayloads['auto-close']
          const done = autoClosePosition(
            ctx,
            String(autoClose.positionId),
            Number(autoClose.version),
          )
          if (!done) {
            ctx.repos.jobs.finishJob(job.id, ctx.clock.now())
            return
          }
          break
        }
        case 'withdrawal-execute': {
          try {
            const withdrawal = payload as JobPayloads['withdrawal-execute']
            await executeWithdrawal(ctx, String(withdrawal.withdrawalId))
          } catch (error) {
            if (error instanceof AppError && error.code === 'RESERVE_INSUFFICIENT') {
              this.options.log.warn(
                { withdrawalId: payload.withdrawalId },
                'withdrawal waiting for reserve funds',
              )
              this.options.ctx.repos.jobs.failJob(job.id, error.message, ctx.clock.now(), 60_000)
              return
            }
            if (error instanceof ScamError && error.definitive) {
              failWithdrawal(ctx, String(payload.withdrawalId), error.message)
              this.options.ctx.repos.jobs.finishJob(job.id, ctx.clock.now())
              return
            }
            throw error
          }
          break
        }
        case 'withdrawal-reconcile': {
          await reconcileWithdrawals(ctx, log)
          break
        }
        case 'deposit-sync': {
          await syncDeposits(ctx, log)
          break
        }
        case 'reserve-monitor': {
          await monitorReserve(ctx, log, this.options.metrics)
          break
        }
        case 'financing': {
          const chargeDate = payload.chargeDate
            ? Number(payload.chargeDate)
            : utcDayStart(ctx.clock.now())
          const result = applyFinancing(ctx, chargeDate)
          log.info(
            { charged: result.charged, amountMicros: result.amountMicros.toString() },
            'financing applied',
          )
          break
        }
        case 'weekend-review': {
          const result = reviewWeekendMargins(ctx)
          if (result.length)
            log.warn({ positions: result.length }, 'weekend margin review found deficits')
          const enforced = enforceWeekendMargins(ctx)
          if (enforced.length) log.warn({ enforced }, 'weekend margin enforcement')
          break
        }
        case 'recalc-risk': {
          const changed = recalcRisk(ctx)
          log.info({ changed }, 'risk recalculated')
          break
        }
        case 'reconcile': {
          const report = reconcileLedger(ctx.repos)
          ctx.repos.market.addReconciliationReport(
            'ledger',
            report.ok,
            report.checks,
            ctx.clock.now(),
          )
          this.options.metrics?.ledgerImbalance.set(report.ok ? 0 : 1)
          if (!report.ok) {
            ctx.repos.runtime.setFlag(
              'halt_all',
              '1',
              'ledger imbalance',
              'reconcile',
              ctx.clock.now(),
            )
            log.error({ report }, 'ledger reconciliation failed; trading halted')
          }
          break
        }
        case 'cleanup': {
          this.cleanup()
          break
        }
        default:
          log.warn({ type: job.type }, 'unknown job type')
      }
      ctx.repos.jobs.finishJob(job.id, ctx.clock.now())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!(
        error instanceof AppError &&
        (error.code === 'POSITION_CLOSED' || error.code === 'MARKET_CLOSED')
      )) {
        log.warn({ jobId: job.id, type: job.type, error: message }, 'job failed')
        this.options.metrics?.jobsFailed.inc()
      }
      ctx.repos.jobs.failJob(job.id, message, ctx.clock.now())
    }
  }

  private cleanup(): void {
    const { ctx } = this.options
    const now = ctx.clock.now()
    ctx.repos.runtime.cleanupExpired(now, ctx.config.retention)
  }
}
