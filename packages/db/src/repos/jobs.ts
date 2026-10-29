import { newId, type JobPayloads, type JobType } from '@fx42/shared'
import { mapJob, n } from '../database'
import type { JobRow } from '../types'
import { RepoBase } from './base'

export class JobRepos extends RepoBase {
  enqueueJob<T extends JobType>(input: {
    type: T
    payload: JobPayloads[T]
    dedupeKey?: string | null
    priority?: number
    runAt?: number
    maxAttempts?: number
    now: number
  }): string | null {
    const id = newId()
    const result = this.sql
      .prepare(
        `INSERT OR IGNORE INTO jobs
          (id, type, priority, payload, dedupe_key, status, run_at, attempts, max_attempts, locked_at,
           last_error, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?, NULL, NULL, ?, NULL)`,
      )
      .run(
        id,
        input.type,
        BigInt(input.priority ?? 100),
        JSON.stringify(input.payload),
        input.dedupeKey ?? null,
        BigInt(input.runAt ?? input.now),
        BigInt(input.maxAttempts ?? 3),
        BigInt(input.now),
      )
    return Number(result.changes) > 0 ? id : null
  }

  claimJob(now: number): JobRow | null {
    const row = this.sql
      .prepare(
        `SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY priority, run_at LIMIT 1`,
      )
      .get(BigInt(now)) as Record<string, unknown> | undefined
    if (!row) return null
    const job = mapJob(row)
    const result = this.sql
      .prepare(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(BigInt(now), job.id)
    if (Number(result.changes) === 0) return null
    return { ...job, status: 'running', attempts: job.attempts + 1 }
  }

  finishJob(id: string, now: number): void {
    this.sql
      .prepare("UPDATE jobs SET status = 'done', finished_at = ?, locked_at = NULL WHERE id = ?")
      .run(BigInt(now), id)
  }

  failJob(id: string, error: string, now: number, retryDelayMs = 5000): void {
    const job = this.sql.prepare('SELECT attempts, max_attempts FROM jobs WHERE id = ?').get(id) as
      { attempts: bigint; max_attempts: bigint } | undefined
    if (!job) return
    if (Number(job.attempts) >= Number(job.max_attempts)) {
      this.sql
        .prepare(
          "UPDATE jobs SET status = 'failed', last_error = ?, finished_at = ?, locked_at = NULL WHERE id = ?",
        )
        .run(error, BigInt(now), id)
    } else {
      this.sql
        .prepare(
          "UPDATE jobs SET status = 'pending', last_error = ?, run_at = ?, locked_at = NULL WHERE id = ?",
        )
        .run(error, BigInt(now + retryDelayMs), id)
    }
  }

  resetStaleJobs(now: number): number {
    const result = this.sql
      .prepare(
        "UPDATE jobs SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < ?",
      )
      .run(BigInt(now - 60_000))
    return Number(result.changes)
  }

  countJobs(status: JobRow['status']): number {
    const row = this.sql.prepare('SELECT count(*) AS c FROM jobs WHERE status = ?').get(status) as {
      c: bigint
    }
    return n(row.c)
  }
}
