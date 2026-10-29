import { positionSummary } from '../risk'
import type { LoggerPort, ReconciliationContext, ReserveMetricsPort } from '../ports'
import { ScamError } from '../ports'
import { resolveReserveAccount } from './credentials'
import { creditDepositFromTransaction } from './deposits'
import { settleWithdrawalSuccess } from './withdrawals'

export async function syncDeposits(ctx: ReconciliationContext, log: LoggerPort): Promise<void> {
  let reserve
  try {
    reserve = await resolveReserveAccount(ctx)
  } catch {
    return
  }
  const state = ctx.repos.funding.getSyncState()
  let txs
  try {
    const result = await ctx.scam.listTransactions(reserve.token, {
      accountId: reserve.scamAccountId,
      limit: 500,
      minId: state.lastScamTxId,
    })
    txs = result.transactions
  } catch (error) {
    if (error instanceof ScamError && (error.status === 401 || error.status === 403)) {
      log.warn({ status: error.status }, 'reserve token rejected during deposit sync')
      return
    }
    log.warn({ error: (error as Error).message }, 'deposit sync failed')
    return
  }
  let maxId = state.lastScamTxId
  for (const tx of txs) {
    if (maxId !== null && tx.id <= maxId) continue
    maxId = tx.id
    if (tx.toAccount !== reserve.iban) continue
    try {
      ctx.uow.run((repos) => creditDepositFromTransaction(ctx, repos, reserve.iban, tx))
    } catch (error) {
      log.error({ txId: tx.id, error: (error as Error).message }, 'failed to credit deposit')
    }
  }
  ctx.repos.funding.setSyncState(maxId, ctx.clock.now())
}

export async function reconcileWithdrawals(
  ctx: ReconciliationContext,
  log: LoggerPort,
): Promise<void> {
  const sending = ctx.repos.funding.listWithdrawalsByStatus(['sending'])
  if (!sending.length) return
  let reserve
  try {
    reserve = await resolveReserveAccount(ctx)
  } catch {
    return
  }
  let txs
  try {
    const result = await ctx.scam.listTransactions(reserve.token, {
      accountId: reserve.scamAccountId,
      limit: 500,
    })
    txs = result.transactions
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'withdrawal reconcile failed')
    return
  }
  for (const w of sending) {
    if (!w.scamRef) continue
    const match = txs.find((tx) => tx.description?.includes(w.scamRef!))
    if (!match) continue
    settleWithdrawalSuccess(ctx, w.id, match.id)
  }
}

export async function monitorReserve(
  ctx: ReconciliationContext,
  log: LoggerPort,
  metrics?: ReserveMetricsPort,
): Promise<number> {
  let reserve
  try {
    reserve = await resolveReserveAccount(ctx)
  } catch {
    return 0
  }
  let balance: number
  try {
    const account = await ctx.scam.getAccount(reserve.token, reserve.scamAccountId)
    balance = Number(account.balance)
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'reserve balance lookup failed')
    return 0
  }
  let liabilities = 0
  liabilities += Number(ctx.repos.wallets.sumUserWalletBalances('real')) / 1e8
  for (const pos of ctx.repos.trading.listOpenPositions()) {
    const account = ctx.repos.users.findAccountById(pos.accountId)
    if (account?.mode !== 'real') continue
    const summary = positionSummary(ctx, pos)
    liabilities += Number(summary.unrealizedPnl) + Number(pos.marginMicros) / 1e8
  }
  const coverage = liabilities <= 0 ? 1 : balance / liabilities
  ctx.repos.runtime.setFlag(
    'reserve_coverage_ok',
    coverage >= 1 ? '1' : '0',
    `coverage=${coverage.toFixed(4)}`,
    'reserve-monitor',
    ctx.clock.now(),
  )
  metrics?.reserveCoverage.set(coverage)
  if (coverage < 1.05) {
    log.warn({ coverage, balance, liabilities }, 'reserve coverage below threshold')
  }
  return coverage
}
