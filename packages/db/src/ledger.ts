import type { SqliteDatabase } from './database'
import { AppError, newId } from '@fx42/shared'

export type LedgerType =
  | 'deposit'
  | 'withdrawal'
  | 'trade_fee'
  | 'realized_pnl'
  | 'margin_lock'
  | 'margin_release'
  | 'financing'
  | 'liquidation'
  | 'bad_debt'
  | 'adjustment'

export interface LedgerEntryInput {
  walletId: string
  amountMicros: bigint
}

export interface PostLedgerInput {
  mode: 'real' | 'virtual'
  type: LedgerType
  refType: string
  refId?: string | null
  memo?: string | null
  entries: LedgerEntryInput[]
  now: number
}

export function postLedger(db: SqliteDatabase, input: PostLedgerInput): string {
  if (input.entries.length < 2) throw new AppError('INTERNAL', { message: 'ledger requires >= 2 entries' })
  const aggregated = new Map<string, bigint>()
  for (const entry of input.entries) {
    if (entry.amountMicros === 0n) continue
    aggregated.set(entry.walletId, (aggregated.get(entry.walletId) ?? 0n) + entry.amountMicros)
  }
  const entries = [...aggregated.entries()]
    .filter(([, amount]) => amount !== 0n)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (entries.length < 2) throw new AppError('INTERNAL', { message: 'ledger requires >= 2 non-zero entries' })
  let total = 0n
  for (const [, amount] of entries) total += amount
  if (total !== 0n) throw new AppError('INTERNAL', { message: 'unbalanced ledger entries' })

  const walletStmt = db.prepare('SELECT id, mode, balance_micros, allow_negative FROM wallets WHERE id = ?')
  const balances = new Map<string, bigint>()
  for (const [walletId] of entries) {
    const wallet = walletStmt.get(walletId) as
      | { id: string; mode: string; balance_micros: bigint; allow_negative: bigint }
      | undefined
    if (!wallet) throw new AppError('INTERNAL', { message: `wallet not found: ${walletId}` })
    if (wallet.mode !== input.mode) throw new AppError('INTERNAL', { message: 'ledger mode mismatch' })
    balances.set(walletId, BigInt(wallet.balance_micros))
  }

  const txId = newId()
  db.prepare(
    `INSERT INTO ledger_txs (id, mode, type, ref_type, ref_id, memo, entry_count, total_micros, finalized, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
  ).run(
    txId,
    input.mode,
    input.type,
    input.refType,
    input.refId ?? null,
    input.memo ?? null,
    BigInt(input.now),
  )

  const insertEntry = db.prepare(
    `INSERT INTO ledger_entries (tx_id, wallet_id, amount_micros, balance_after_micros, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const updateWallet = db.prepare(
    'UPDATE wallets SET balance_micros = ?, updated_at = ? WHERE id = ?',
  )
  for (const [walletId, amount] of entries) {
    const next = (balances.get(walletId) ?? 0n) + amount
    if (next < 0n) {
      const wallet = walletStmt.get(walletId) as { allow_negative: bigint }
      if (BigInt(wallet.allow_negative) !== 1n) {
        throw new AppError('INSUFFICIENT_BALANCE', {
          message: `wallet ${walletId} would go negative`,
        })
      }
    }
    balances.set(walletId, next)
  }
  for (const [walletId, amount] of entries) {
    const balanceAfter = balances.get(walletId) ?? 0n
    insertEntry.run(txId, walletId, amount, balanceAfter, BigInt(input.now))
  }
  for (const [walletId] of entries) {
    updateWallet.run(balances.get(walletId) ?? 0n, BigInt(input.now), walletId)
  }
  db.prepare('UPDATE ledger_txs SET finalized = 1 WHERE id = ?').run(txId)
  return txId
}

export function walletIdForAccount(db: SqliteDatabase, accountId: string): string {
  const row = db
    .prepare("SELECT id FROM wallets WHERE account_id = ? AND kind = 'user'")
    .get(accountId) as { id: string } | undefined
  if (!row) throw new AppError('INTERNAL', { message: `user wallet missing for account ${accountId}` })
  return row.id
}

export function systemWalletId(mode: 'real' | 'virtual', kind: string): string {
  return `sys:${mode}:${kind}`
}

export function systemBalance(db: SqliteDatabase, mode: 'real' | 'virtual', kind: string): bigint {
  const row = db
    .prepare('SELECT balance_micros FROM wallets WHERE id = ?')
    .get(systemWalletId(mode, kind)) as { balance_micros: bigint } | undefined
  if (!row) throw new AppError('INTERNAL', { message: `system wallet missing: ${mode}/${kind}` })
  return BigInt(row.balance_micros)
}
