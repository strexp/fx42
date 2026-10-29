import { newId } from '@fx42/shared'
import { mapNotification } from '../database'
import type { NotificationRow } from '../types'
import { RepoBase } from './base'

export class RuntimeRepos extends RepoBase {
  latestConfigSnapshot(): { canonicalJson: string } | null {
    const row = this.sql
      .prepare('SELECT canonical_json FROM config_snapshots ORDER BY loaded_at DESC LIMIT 1')
      .get() as { canonical_json: string } | undefined
    return row ? { canonicalJson: row.canonical_json } : null
  }

  cleanupExpired(
    now: number,
    retention: { notificationsDays: number; candles1mDays: number; candles1hDays: number },
  ): void {
    this.sql
      .prepare("DELETE FROM jobs WHERE status IN ('done','failed') AND finished_at < ?")
      .run(BigInt(now - 30 * 86_400_000))
    this.sql
      .prepare('DELETE FROM notifications WHERE created_at < ?')
      .run(BigInt(now - retention.notificationsDays * 86_400_000))
    this.sql
      .prepare("DELETE FROM candles WHERE interval IN ('1m','5m') AND open_time < ?")
      .run(BigInt(now - retention.candles1mDays * 86_400_000))
    this.sql
      .prepare("DELETE FROM candles WHERE interval IN ('1h','4h') AND open_time < ?")
      .run(BigInt(now - retention.candles1hDays * 86_400_000))
    this.sql
      .prepare(
        `DELETE FROM config_snapshots WHERE id NOT IN
           (SELECT id FROM config_snapshots ORDER BY loaded_at DESC LIMIT 100)`,
      )
      .run()
  }

  getFlag(key: string): string | null {
    const row = this.sql.prepare('SELECT value FROM runtime_flags WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  setFlag(key: string, value: string, reason: string | null, by: string, now: number): void {
    this.sql
      .prepare(
        `INSERT INTO runtime_flags (key, value, reason, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, reason = excluded.reason,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(key, value, reason, by, BigInt(now))
  }

  addNotification(userId: string, kind: string, payload: unknown, now: number): NotificationRow {
    const id = newId()
    this.sql
      .prepare(
        'INSERT INTO notifications (id, user_id, kind, payload, read_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
      )
      .run(id, userId, kind, JSON.stringify(payload), BigInt(now))
    const row = this.sql.prepare('SELECT * FROM notifications WHERE id = ?').get(id)
    return mapNotification(row as Record<string, unknown>)
  }

  hasUnreadNotificationForPosition(
    userId: string,
    positionId: string,
    kindPrefix: string,
  ): boolean {
    const row = this.sql
      .prepare(
        `SELECT 1 AS found FROM notifications
         WHERE user_id = ? AND read_at IS NULL AND kind LIKE ?
           AND json_extract(payload, '$.positionId') = ?
         LIMIT 1`,
      )
      .get(userId, `${kindPrefix}%`, positionId) as { found: number } | undefined
    return Boolean(row)
  }

  listNotifications(userId: string, limit: number): NotificationRow[] {
    return (
      this.sql
        .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(userId, BigInt(limit)) as Record<string, unknown>[]
    ).map(mapNotification)
  }

  markNotificationsRead(userId: string, now: number): number {
    const result = this.sql
      .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .run(BigInt(now), userId)
    return Number(result.changes)
  }

  audit(input: {
    actorId: string | null
    action: string
    target: string | null
    before: unknown
    after: unknown
    ip: string | null
    now: number
  }): void {
    this.sql
      .prepare(
        'INSERT INTO audit_logs (actor_id, action, target, before, after, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.actorId,
        input.action,
        input.target,
        input.before === null || input.before === undefined ? null : JSON.stringify(input.before),
        input.after === null || input.after === undefined ? null : JSON.stringify(input.after),
        input.ip,
        BigInt(input.now),
      )
  }
}
