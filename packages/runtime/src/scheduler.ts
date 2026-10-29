import cron from 'node-cron'
import type { JobWorker } from './jobs'
import type { AppContext } from '@fx42/application'
import { DAY_MS, utcDayStart, type NoPayloadJob } from '@fx42/shared'

export class Scheduler {
  private intervals: NodeJS.Timeout[] = []
  private tasks: Array<ReturnType<typeof cron.schedule>> = []

  constructor(
    private readonly ctx: AppContext,
    private readonly jobs: JobWorker,
  ) {}

  start(): void {
    this.interval(30_000, 'deposit-sync', { dedupeKey: 'deposit-sync', priority: 20 })
    this.interval(30_000, 'withdrawal-reconcile', {
      dedupeKey: 'withdrawal-reconcile',
      priority: 20,
    })
    this.interval(5 * 60_000, 'reserve-monitor', { dedupeKey: 'reserve-monitor', priority: 200 })
    this.interval(5 * 60_000, 'reconcile', { dedupeKey: 'reconcile', priority: 300 })
    this.interval(5 * 60_000, 'weekend-review', { dedupeKey: 'weekend-review', priority: 40 })
    this.interval(24 * 60 * 60_000, 'cleanup', { dedupeKey: 'cleanup', priority: 500 })
    // Daily financing at 00:00 UTC.
    this.tasks.push(
      cron.schedule('0 0 * * *', () => {
        this.jobs.enqueue(
          'financing',
          { chargeDate: utcDayStart(this.ctx.clock.now()) },
          { dedupeKey: `financing:${utcDayStart(this.ctx.clock.now())}`, priority: 30 },
        )
      }),
    )
    // Catch up on missed financing runs at startup (last 7 days, idempotent).
    for (let i = 0; i < 7; i++) {
      const day = utcDayStart(this.ctx.clock.now() - i * DAY_MS)
      this.jobs.enqueue(
        'financing',
        { chargeDate: day },
        { dedupeKey: `financing:${day}`, priority: 30 },
      )
    }
  }

  stop(): void {
    for (const t of this.intervals) clearInterval(t)
    for (const t of this.tasks) t.stop()
    this.intervals = []
    this.tasks = []
  }

  private interval(
    ms: number,
    type: NoPayloadJob,
    options: { dedupeKey: string; priority: number },
  ): void {
    const timer = setInterval(() => {
      this.jobs.enqueue(type, {}, { ...options, maxAttempts: 5 })
    }, ms)
    timer.unref?.()
    this.intervals.push(timer)
  }
}
