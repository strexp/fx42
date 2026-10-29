import { newId } from '@fx42/shared'
import { b, mapDeposit, mapWithdrawal, n, nn } from '../database'

import type { DepositRow, WithdrawalRow } from '../types'

import { RepoBase } from './base'

export class FundingRepos extends RepoBase {
  findDepositById(id: string): DepositRow | null {
    const row = this.sql.prepare('SELECT * FROM deposits WHERE id = ?').get(id)
    return row ? mapDeposit(row as Record<string, unknown>) : null
  }

  findDepositByRequest(accountId: string, requestId: string): DepositRow | null {
    const row = this.sql
      .prepare('SELECT * FROM deposits WHERE account_id = ? AND request_id = ?')
      .get(accountId, requestId)
    return row ? mapDeposit(row as Record<string, unknown>) : null
  }

  findDepositByMemo(memo: string): DepositRow | null {
    const row = this.sql.prepare('SELECT * FROM deposits WHERE memo_code = ?').get(memo)
    return row ? mapDeposit(row as Record<string, unknown>) : null
  }

  findDepositByScamTx(scamTxId: number): DepositRow | null {
    const row = this.sql
      .prepare('SELECT * FROM deposits WHERE scam_tx_id = ?')
      .get(BigInt(scamTxId))
    return row ? mapDeposit(row as Record<string, unknown>) : null
  }

  createDeposit(input: {
    userId: string
    accountId: string
    mode: 'real' | 'virtual'
    method: 'transfer' | 'virtual'
    amountMicros: bigint
    requestId: string | null
    memoCode: string | null
    expiresAt: number | null
    status: DepositRow['status']
    feeMicros?: bigint
    creditedMicros?: bigint | null
    receivedMicros?: bigint | null
    now: number
  }): DepositRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO deposits
          (id, user_id, account_id, mode, method, scam_tx_id, amount_micros, received_micros, fee_micros,
           credited_micros, request_id, status, memo_code, expires_at, raw, created_at, credited_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.accountId,
        input.mode,
        input.method,
        input.amountMicros,
        input.receivedMicros ?? null,
        input.feeMicros ?? 0n,
        input.creditedMicros ?? null,
        input.requestId,
        input.status,
        input.memoCode,
        input.expiresAt === null ? null : BigInt(input.expiresAt),
        BigInt(input.now),
        input.creditedMicros !== undefined && input.creditedMicros !== null
          ? BigInt(input.now)
          : null,
      )
    return this.findDepositById(id)!
  }

  creditDeposit(input: {
    id: string
    scamTxId: number | null
    receivedMicros: bigint
    feeMicros: bigint
    creditedMicros: bigint
    raw: string | null
    now: number
  }): void {
    this.sql
      .prepare(
        `UPDATE deposits SET status = 'credited', scam_tx_id = COALESCE(scam_tx_id, ?), received_micros = ?,
           fee_micros = ?, credited_micros = ?, raw = ?, credited_at = ? WHERE id = ?`,
      )
      .run(
        input.scamTxId === null ? null : BigInt(input.scamTxId),
        input.receivedMicros,
        input.feeMicros,
        input.creditedMicros,
        input.raw,
        BigInt(input.now),
        input.id,
      )
  }

  setDepositStatus(id: string, status: DepositRow['status']): void {
    this.sql.prepare('UPDATE deposits SET status = ? WHERE id = ?').run(status, id)
  }

  listDeposits(
    userId: string,
    mode: 'real' | 'virtual',
    limit: number,
    offset: number,
  ): DepositRow[] {
    return (
      this.sql
        .prepare(
          'SELECT * FROM deposits WHERE user_id = ? AND mode = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        )
        .all(userId, mode, BigInt(limit), BigInt(offset)) as Record<string, unknown>[]
    ).map(mapDeposit)
  }

  countPendingDeposits(userId: string): number {
    const row = this.sql
      .prepare("SELECT count(*) AS c FROM deposits WHERE user_id = ? AND status = 'pending'")
      .get(userId) as { c: bigint }
    return n(row.c)
  }

  sumDepositAmountSince(userId: string, mode: 'real' | 'virtual', since: number): bigint {
    const row = this.sql
      .prepare(
        "SELECT COALESCE(sum(amount_micros),0) AS s FROM deposits WHERE user_id = ? AND mode = ? AND status IN ('pending','credited') AND created_at >= ?",
      )
      .get(userId, mode, BigInt(since)) as { s: bigint }
    return BigInt(row.s)
  }

  // -------------------------------------------------------------- withdrawals
  findWithdrawalById(id: string): WithdrawalRow | null {
    const row = this.sql.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id)
    return row ? mapWithdrawal(row as Record<string, unknown>) : null
  }

  findWithdrawalByKey(key: string): WithdrawalRow | null {
    const row = this.sql.prepare('SELECT * FROM withdrawals WHERE idempotency_key = ?').get(key)
    return row ? mapWithdrawal(row as Record<string, unknown>) : null
  }

  createWithdrawal(input: {
    userId: string
    accountId: string
    mode: 'real' | 'virtual'
    amountMicros: bigint
    feeMicros: bigint
    netMicros: bigint
    destinationAccountId: string | null
    destinationIban: string | null
    status: WithdrawalRow['status']
    idempotencyKey: string
    scamRef: string | null
    now: number
  }): WithdrawalRow {
    const id = newId()
    this.sql
      .prepare(
        `INSERT INTO withdrawals
          (id, user_id, account_id, mode, amount_micros, fee_micros, net_micros, destination_account_id,
           destination_iban, status, idempotency_key, scam_ref, scam_tx_id, error, requested_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.accountId,
        input.mode,
        input.amountMicros,
        input.feeMicros,
        input.netMicros,
        input.destinationAccountId,
        input.destinationIban,
        input.status,
        input.idempotencyKey,
        input.scamRef,
        BigInt(input.now),
        input.status === 'settled' ? BigInt(input.now) : null,
      )
    return this.findWithdrawalById(id)!
  }

  setWithdrawalStatus(
    id: string,
    status: WithdrawalRow['status'],
    input: { scamTxId?: number | null; error?: string | null; now: number } = { now: 0 },
  ): void {
    this.sql
      .prepare(
        `UPDATE withdrawals SET status = ?, scam_tx_id = COALESCE(?, scam_tx_id), error = ?,
           sent_at = CASE WHEN ? IN ('sent','settled') THEN ? ELSE sent_at END WHERE id = ?`,
      )
      .run(
        status,
        input.scamTxId === undefined || input.scamTxId === null ? null : BigInt(input.scamTxId),
        input.error ?? null,
        status,
        BigInt(input.now),
        id,
      )
  }

  listWithdrawals(
    userId: string,
    mode: 'real' | 'virtual',
    limit: number,
    offset: number,
  ): WithdrawalRow[] {
    return (
      this.sql
        .prepare(
          'SELECT * FROM withdrawals WHERE user_id = ? AND mode = ? ORDER BY requested_at DESC LIMIT ? OFFSET ?',
        )
        .all(userId, mode, BigInt(limit), BigInt(offset)) as Record<string, unknown>[]
    ).map(mapWithdrawal)
  }

  listWithdrawalsByStatus(statuses: WithdrawalRow['status'][]): WithdrawalRow[] {
    const placeholders = statuses.map(() => '?').join(',')
    return (
      this.sql
        .prepare(
          `SELECT * FROM withdrawals WHERE status IN (${placeholders}) ORDER BY requested_at`,
        )
        .all(...statuses) as Record<string, unknown>[]
    ).map(mapWithdrawal)
  }

  sumWithdrawnSince(userId: string, mode: 'real' | 'virtual', since: number): bigint {
    const row = this.sql
      .prepare(
        `SELECT COALESCE(sum(amount_micros),0) AS s FROM withdrawals
         WHERE user_id = ? AND mode = ? AND status IN ('requested','sending','sent','settled') AND requested_at >= ?`,
      )
      .get(userId, mode, BigInt(since)) as { s: bigint }
    return BigInt(row.s)
  }

  // --------------------------------------------------------------- unmatched
  insertUnmatched(input: {
    scamTxId: number
    fromAccount: string | null
    amountMicros: bigint
    description: string | null
    reason: string
    now: number
  }): void {
    this.sql
      .prepare(
        `INSERT OR IGNORE INTO unmatched_transfers
          (id, scam_tx_id, from_account, amount_micros, description, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(
        newId(),
        BigInt(input.scamTxId),
        input.fromAccount,
        input.amountMicros,
        input.description,
        input.reason,
        BigInt(input.now),
      )
  }

  listUnmatched(status: 'open' | 'matched' | 'ignored' = 'open'): Array<Record<string, unknown>> {
    const rows = this.sql
      .prepare('SELECT * FROM unmatched_transfers WHERE status = ? ORDER BY created_at')
      .all(status) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: String(r.id),
      scamTxId: n(r.scam_tx_id),
      fromAccount: r.from_account as string | null,
      amountMicros: b(r.amount_micros),
      description: r.description as string | null,
      reason: String(r.reason),
      status: String(r.status),
      createdAt: n(r.created_at),
    }))
  }

  setUnmatchedStatus(id: string, status: 'matched' | 'ignored'): void {
    this.sql.prepare('UPDATE unmatched_transfers SET status = ? WHERE id = ?').run(status, id)
  }

  findUnmatchedByTx(scamTxId: number): Record<string, unknown> | null {
    const row = this.sql
      .prepare('SELECT * FROM unmatched_transfers WHERE scam_tx_id = ?')
      .get(BigInt(scamTxId))
    return (row as Record<string, unknown>) ?? null
  }

  getSyncState(): { lastScamTxId: number | null; lastScanAt: number | null } {
    const row = this.sql
      .prepare('SELECT last_scam_tx_id, last_scan_at FROM deposit_sync_state WHERE id = 1')
      .get() as { last_scam_tx_id: bigint | null; last_scan_at: bigint | null }
    return { lastScamTxId: nn(row.last_scam_tx_id), lastScanAt: nn(row.last_scan_at) }
  }

  setSyncState(lastScamTxId: number | null, now: number): void {
    this.sql
      .prepare(
        'UPDATE deposit_sync_state SET last_scam_tx_id = ?, last_scan_at = ?, updated_at = ? WHERE id = 1',
      )
      .run(lastScamTxId === null ? null : BigInt(lastScamTxId), BigInt(now), BigInt(now))
  }
}
