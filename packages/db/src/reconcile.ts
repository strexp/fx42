import type { Fx42Db } from './database'
import { n } from './database'

export interface ReconcileCheck {
  name: string
  ok: boolean
  details?: unknown
}

export interface ReconciliationRepos {
  db: Fx42Db
  wallets: { systemBalance(mode: 'real' | 'virtual', kind: string): bigint }
}

export function reconcile(repos: ReconciliationRepos): { ok: boolean; checks: ReconcileCheck[] } {
  const sql = repos.db.raw
  const checks: ReconcileCheck[] = []

  const sumEntries = sql
    .prepare('SELECT COALESCE(sum(amount_micros),0) AS s FROM ledger_entries')
    .get() as {
    s: bigint
  }
  checks.push({
    name: 'sum(ledger_entries)=0',
    ok: BigInt(sumEntries.s) === 0n,
    details: { sum: sumEntries.s.toString() },
  })

  const walletMismatch = sql
    .prepare(
      `SELECT count(*) AS c FROM wallets w WHERE w.balance_micros <>
        (SELECT COALESCE(sum(e.amount_micros),0) FROM ledger_entries e WHERE e.wallet_id = w.id)`,
    )
    .get() as { c: bigint }
  checks.push({
    name: 'wallet balances match entries',
    ok: n(walletMismatch.c) === 0,
    details: { mismatches: n(walletMismatch.c) },
  })

  for (const mode of ['real', 'virtual'] as const) {
    const margin = sql
      .prepare(
        `SELECT COALESCE(sum(p.margin_micros),0) AS s FROM positions p
         JOIN trading_accounts ta ON p.account_id = ta.id
         WHERE p.status = 'open' AND ta.mode = ?`,
      )
      .get(mode) as { s: bigint }
    const pool = repos.wallets.systemBalance(mode, 'margin_pool')
    checks.push({
      name: `margin_pool[${mode}] equals open margin`,
      ok: BigInt(margin.s) === pool,
      details: { positions: margin.s.toString(), pool: pool.toString() },
    })

    const pending = sql
      .prepare(
        `SELECT COALESCE(sum(amount_micros),0) AS s FROM withdrawals
         WHERE mode = ? AND status IN ('requested','sending')`,
      )
      .get(mode) as { s: bigint }
    const pendingWallet = repos.wallets.systemBalance(mode, 'withdrawal_pending')
    checks.push({
      name: `withdrawal_pending[${mode}] equals pending withdrawals`,
      ok: BigInt(pending.s) === pendingWallet,
      details: { withdrawals: pending.s.toString(), wallet: pendingWallet.toString() },
    })

    const fee = sql
      .prepare(
        `SELECT COALESCE(sum(amount_micros),0) AS s FROM ledger_entries e
         JOIN ledger_txs t ON e.tx_id = t.id
         JOIN wallets w ON e.wallet_id = w.id
         WHERE t.mode = ? AND w.kind = 'fee_income'`,
      )
      .get(mode) as { s: bigint }
    const feeWallet = repos.wallets.systemBalance(mode, 'fee_income')
    checks.push({
      name: `fee_income[${mode}] matches ledger`,
      ok: BigInt(fee.s) === feeWallet,
      details: { ledger: fee.s.toString(), wallet: feeWallet.toString() },
    })

    const badDebt = sql
      .prepare(
        `SELECT COALESCE(sum(amount_micros),0) AS s FROM ledger_entries e
         JOIN ledger_txs t ON e.tx_id = t.id
         JOIN wallets w ON e.wallet_id = w.id
         WHERE t.mode = ? AND w.kind = 'bad_debt'`,
      )
      .get(mode) as { s: bigint }
    const badDebtWallet = repos.wallets.systemBalance(mode, 'bad_debt')
    checks.push({
      name: `bad_debt[${mode}] matches ledger`,
      ok: BigInt(badDebt.s) === badDebtWallet,
      details: { ledger: badDebt.s.toString(), wallet: badDebtWallet.toString() },
    })
  }

  const unbalanced = sql
    .prepare(
      'SELECT count(*) AS c FROM ledger_txs WHERE finalized = 1 AND (entry_count < 2 OR total_micros <> 0)',
    )
    .get() as { c: bigint }
  checks.push({
    name: 'all finalized txs balanced',
    ok: n(unbalanced.c) === 0,
    details: { count: n(unbalanced.c) },
  })

  const mixed = sql
    .prepare(
      `SELECT count(*) AS c FROM ledger_entries e
       JOIN ledger_txs t ON e.tx_id = t.id
       JOIN wallets w ON e.wallet_id = w.id
       WHERE w.mode <> t.mode`,
    )
    .get() as { c: bigint }
  checks.push({
    name: 'no mixed-mode ledger txs',
    ok: n(mixed.c) === 0,
    details: { count: n(mixed.c) },
  })

  return { ok: checks.every((c) => c.ok), checks }
}
