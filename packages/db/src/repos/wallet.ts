import { mapWallet } from '../database'
import { postLedger, systemBalance, walletIdForAccount, type PostLedgerInput } from '../ledger'
import type { WalletRow } from '../types'

import { RepoBase } from './base'

export class WalletRepos extends RepoBase {
  findUserWallet(accountId: string): WalletRow | null {
    const row = this.sql
      .prepare("SELECT * FROM wallets WHERE account_id = ? AND kind = 'user'")
      .get(accountId)
    return row ? mapWallet(row as Record<string, unknown>) : null
  }

  walletIdForAccount(accountId: string): string {
    return walletIdForAccount(this.sql, accountId)
  }

  systemBalance(mode: 'real' | 'virtual', kind: string): bigint {
    return systemBalance(this.sql, mode, kind)
  }

  sumUserWalletBalances(mode: 'real' | 'virtual'): bigint {
    const row = this.sql
      .prepare(
        `SELECT COALESCE(sum(w.balance_micros),0) AS total
         FROM wallets w
         JOIN trading_accounts ta ON w.account_id = ta.id
         WHERE ta.mode = ? AND w.kind = 'user'`,
      )
      .get(mode) as { total: bigint }
    return row.total
  }

  listWalletLedger(
    accountId: string,
    mode: 'real' | 'virtual',
    limit: number,
    offset: number,
  ): Array<{
    amountMicros: bigint
    balanceAfterMicros: bigint
    createdAt: number
    type: string
    refType: string
    refId: string | null
    memo: string | null
  }> {
    const rows = this.sql
      .prepare(
        `SELECT e.amount_micros, e.balance_after_micros, e.created_at,
                t.type, t.ref_type, t.ref_id, t.memo
         FROM ledger_entries e
         JOIN ledger_txs t ON e.tx_id = t.id
         JOIN wallets w ON e.wallet_id = w.id
         WHERE w.account_id = ? AND t.mode = ?
         ORDER BY e.id DESC LIMIT ? OFFSET ?`,
      )
      .all(accountId, mode, BigInt(limit), BigInt(offset)) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      amountMicros: BigInt(r.amount_micros as bigint),
      balanceAfterMicros: BigInt(r.balance_after_micros as bigint),
      createdAt: Number(r.created_at),
      type: String(r.type),
      refType: String(r.ref_type),
      refId: r.ref_id as string | null,
      memo: r.memo as string | null,
    }))
  }

  postLedger(input: Omit<PostLedgerInput, 'now'> & { now?: number }): string {
    return postLedger(this.sql, { ...input, now: input.now ?? this.now() })
  }
}
