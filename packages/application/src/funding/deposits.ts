import Decimal from 'decimal.js'
import { AppError, bps, dec, fromMicros, memoCode as makeMemoCode, toMicros } from '@fx42/shared'
import { getAccount, getUser, requireTerms, utcDayStart } from '../helpers'
import type { FundingContext, Repos, ScamTransactionInfo } from '../ports'
import { ScamError } from '../ports'
import type { DepositRow } from '@fx42/db'
import { reserveConfig } from './credentials'

const DEPOSIT_MEMO_RE = /FX42-[A-Z0-9]{8}/

export async function createAutoDeposit(
  ctx: FundingContext,
  userId: string,
  input: { accountId: string; amount: string; requestId: string },
): Promise<DepositRow> {
  const user = getUser(ctx, userId)
  if (user.status !== 'active') throw new AppError('USER_SUSPENDED')
  requireTerms(ctx.repos, userId)
  const account = getAccount(ctx, userId, 'real')
  const credential = ctx.repos.credentials.findActiveCredential(userId)
  if (!credential) throw new AppError('TOKEN_REQUIRED')
  const source = ctx.repos.credentials.findScamAccount(input.accountId)
  const sourceCredential = source
    ? ctx.repos.credentials.findCredentialById(source.credentialId)
    : null
  if (
    !source ||
    !sourceCredential ||
    sourceCredential.userId !== userId ||
    sourceCredential.status !== 'active'
  ) {
    throw new AppError('DESTINATION_FORBIDDEN', { message: 'source account is not yours' })
  }
  const reserve = reserveConfig(ctx)
  if (source.iban === reserve.iban) {
    throw new AppError('VALIDATION_ERROR', {
      message: 'reserve account cannot be a deposit source',
    })
  }
  const existing = ctx.repos.funding.findDepositByRequest(account.id, input.requestId)
  if (existing) return existing

  const requested = dec(input.amount)
  const transferAmount = requested.toDecimalPlaces(4, Decimal.ROUND_DOWN)
  const amountMicros = toMicros(transferAmount)
  if (
    amountMicros < toMicros(ctx.config.funding.minDeposit) ||
    transferAmount.gt(dec(ctx.config.funding.maxDeposit))
  ) {
    throw new AppError('DEPOSIT_LIMIT', {
      details: { min: ctx.config.funding.minDeposit, max: ctx.config.funding.maxDeposit },
    })
  }
  const now = ctx.clock.now()
  const today = utcDayStart(now)
  const used = ctx.repos.funding.sumDepositAmountSince(userId, 'real', today)
  if (used + amountMicros > toMicros(ctx.config.funding.maxDepositPerDay)) {
    throw new AppError('DEPOSIT_LIMIT', { message: 'daily deposit limit reached' })
  }
  if (ctx.repos.funding.countPendingDeposits(userId) >= ctx.config.funding.maxPendingDeposits) {
    throw new AppError('DEPOSIT_LIMIT', { message: 'too many pending deposits' })
  }

  const expiresAt = now + ctx.config.funding.memoExpiryMinutes * 60_000
  const deposit = ctx.uow.run((repos) => {
    const duplicate = repos.funding.findDepositByRequest(account.id, input.requestId)
    if (duplicate) return duplicate
    let memo = ''
    for (let i = 0; i < 10; i++) {
      memo = makeMemoCode()
      if (!repos.funding.findDepositByMemo(memo)) break
      memo = ''
    }
    if (!memo) throw new AppError('INTERNAL', { message: 'could not allocate memo code' })
    const row = repos.funding.createDeposit({
      userId,
      accountId: account.id,
      mode: 'real',
      method: 'transfer',
      amountMicros,
      requestId: input.requestId,
      memoCode: memo,
      expiresAt,
      status: 'pending',
      now,
    })
    repos.runtime.audit({
      actorId: userId,
      action: 'deposit.auto.create',
      target: row.id,
      before: null,
      after: {
        amount: transferAmount.toString(),
        source: source.iban,
        reserve: reserve.iban,
      },
      ip: null,
      now,
    })
    return row
  })

  let token: string
  try {
    token = ctx.crypto.decrypt(credential.tokenCipher, credential.keyVersion)
  } catch {
    ctx.uow.run((repos) => repos.funding.setDepositStatus(deposit.id, 'failed'))
    throw new AppError('TOKEN_INVALID')
  }

  const amountText = fromMicros(amountMicros, 4)
  let transfer
  try {
    transfer = await ctx.scam.transfer(token, {
      fromAccountId: source.scamAccountId,
      toIban: reserve.iban,
      amount: amountText,
      description: `FX42 deposit ${deposit.memoCode}`,
      idempotencyKey: deposit.id,
    })
  } catch (error) {
    if (error instanceof ScamError && (error.status === 401 || error.status === 403)) {
      ctx.repos.credentials.setCredentialStatus(credential.id, 'invalid', ctx.clock.now())
      ctx.uow.run((repos) => repos.funding.setDepositStatus(deposit.id, 'failed'))
      throw new AppError('TOKEN_INVALID')
    }
    if (error instanceof ScamError && error.definitive) {
      ctx.uow.run((repos) => repos.funding.setDepositStatus(deposit.id, 'failed'))
      throw new AppError('SCAM_REJECTED', { message: error.message })
    }
    // Timeout/5xx: the transfer may have succeeded. Keep the deposit pending;
    // deposit-sync will match the memo in the reserve transaction history.
    return ctx.repos.funding.findDepositById(deposit.id)!
  }

  if (transfer.transactionId !== null) {
    const tx: ScamTransactionInfo = {
      id: transfer.transactionId,
      fromAccount: source.iban,
      toAccount: reserve.iban,
      amount: amountText,
      description: `FX42 deposit ${deposit.memoCode}`,
      type: 'transfer',
      createdAt: now,
    }
    ctx.uow.run((repos) => creditDepositFromTransaction(ctx, repos, reserve.iban, tx))
  }
  return ctx.repos.funding.findDepositById(deposit.id)!
}

export function createVirtualDeposit(
  ctx: FundingContext,
  userId: string,
  input: { amount: string; requestId: string },
): DepositRow {
  const user = getUser(ctx, userId)
  if (user.status !== 'active') throw new AppError('USER_SUSPENDED')
  requireTerms(ctx.repos, userId)
  const account = getAccount(ctx, userId, 'virtual')
  const existing = ctx.repos.funding.findDepositByRequest(account.id, input.requestId)
  if (existing) return existing
  const amount = dec(input.amount)
  const max = dec(ctx.config.virtual.maxDeposit)
  if (amount.lt(dec('0.01')) || amount.gt(max)) {
    throw new AppError('DEPOSIT_LIMIT', { details: { max: max.toString() } })
  }
  const now = ctx.clock.now()
  const start = utcDayStart(now)
  const used = ctx.repos.funding.sumDepositAmountSince(userId, 'virtual', start)
  if (used + toMicros(amount) > toMicros(ctx.config.virtual.maxDailyDeposit)) {
    throw new AppError('DEPOSIT_LIMIT', { message: 'daily virtual deposit limit reached' })
  }
  const amountMicros = toMicros(amount)
  return ctx.uow.run((repos) => {
    const duplicate = repos.funding.findDepositByRequest(account.id, input.requestId)
    if (duplicate) return duplicate
    const walletId = repos.wallets.walletIdForAccount(account.id)
    const deposit = repos.funding.createDeposit({
      userId,
      accountId: account.id,
      mode: 'virtual',
      method: 'virtual',
      amountMicros,
      requestId: input.requestId,
      memoCode: null,
      expiresAt: null,
      status: 'credited',
      feeMicros: 0n,
      receivedMicros: amountMicros,
      creditedMicros: amountMicros,
      now,
    })
    repos.wallets.postLedger({
      mode: 'virtual',
      type: 'deposit',
      refType: 'deposit',
      refId: deposit.id,
      memo: 'virtual deposit',
      entries: [
        { walletId, amountMicros },
        { walletId: 'sys:virtual:external_reserve', amountMicros: -amountMicros },
      ],
      now,
    })
    repos.runtime.audit({
      actorId: userId,
      action: 'deposit.virtual',
      target: deposit.id,
      before: null,
      after: { amount: amount.toString() },
      ip: null,
      now,
    })
    return repos.funding.findDepositById(deposit.id)!
  })
}

export interface CreditResult {
  status: 'credited' | 'unmatched' | 'skipped'
  depositId?: string
  reason?: string
}

/**
 * Match a reserve-account transaction to a pending deposit. Must run inside a
 * UnitOfWork/lock by the caller. Idempotent on scam_tx_id.
 */
export function creditDepositFromTransaction(
  ctx: FundingContext,
  repos: Repos,
  reserveIban: string,
  tx: ScamTransactionInfo,
): CreditResult {
  if (tx.toAccount !== reserveIban) return { status: 'skipped' }
  if (repos.funding.findDepositByScamTx(tx.id) || repos.funding.findUnmatchedByTx(tx.id)) {
    return { status: 'skipped' }
  }
  const description = tx.description ?? ''
  const match = description.match(DEPOSIT_MEMO_RE)
  const now = ctx.clock.now()
  const amountMicros = toMicros(tx.amount)
  if (!match) {
    repos.funding.insertUnmatched({
      scamTxId: tx.id,
      fromAccount: tx.fromAccount,
      amountMicros,
      description,
      reason: 'no_memo',
      now,
    })
    return { status: 'unmatched', reason: 'no_memo' }
  }
  const memo = match[0]
  const deposit = repos.funding.findDepositByMemo(memo)
  if (!deposit) {
    repos.funding.insertUnmatched({
      scamTxId: tx.id,
      fromAccount: tx.fromAccount,
      amountMicros,
      description,
      reason: 'unknown_memo',
      now,
    })
    return { status: 'unmatched', reason: 'unknown_memo' }
  }
  if (deposit.status === 'cancelled') {
    repos.funding.insertUnmatched({
      scamTxId: tx.id,
      fromAccount: tx.fromAccount,
      amountMicros,
      description,
      reason: 'cancelled',
      now,
    })
    return { status: 'unmatched', reason: 'cancelled' }
  }
  if (deposit.expiresAt && deposit.expiresAt < now - 7 * 86_400_000) {
    repos.funding.insertUnmatched({
      scamTxId: tx.id,
      fromAccount: tx.fromAccount,
      amountMicros,
      description,
      reason: 'expired',
      now,
    })
    return { status: 'unmatched', reason: 'expired' }
  }
  if (deposit.status === 'credited' && deposit.scamTxId !== tx.id) {
    repos.funding.insertUnmatched({
      scamTxId: tx.id,
      fromAccount: tx.fromAccount,
      amountMicros,
      description,
      reason: 'memo_already_credited',
      now,
    })
    return { status: 'unmatched', reason: 'memo_already_credited' }
  }
  if (!tx.fromAccount) {
    repos.funding.insertUnmatched({
      scamTxId: tx.id,
      fromAccount: null,
      amountMicros,
      description,
      reason: 'sender_mismatch',
      now,
    })
    return { status: 'unmatched', reason: 'sender_mismatch' }
  }
  const sender = repos.credentials.findScamAccountByIban(tx.fromAccount)
  const senderCredential = sender ? repos.credentials.findCredentialById(sender.credentialId) : null
  if (
    !sender ||
    !senderCredential ||
    senderCredential.userId !== deposit.userId ||
    !['active', 'invalid'].includes(senderCredential.status)
  ) {
    repos.funding.insertUnmatched({
      scamTxId: tx.id,
      fromAccount: tx.fromAccount,
      amountMicros,
      description,
      reason: 'sender_mismatch',
      now,
    })
    return { status: 'unmatched', reason: 'sender_mismatch' }
  }

  const feeMicros = toMicros(dec(tx.amount).mul(bps(ctx.config.fees.depositBps)), 'ceil')
  const creditedMicros = amountMicros - feeMicros
  const account = repos.users.findAccountById(deposit.accountId)
  if (!account) throw new AppError('INTERNAL', { message: 'deposit account missing' })
  const walletId = repos.wallets.walletIdForAccount(account.id)
  repos.wallets.postLedger({
    mode: 'real',
    type: 'deposit',
    refType: 'deposit',
    refId: deposit.id,
    memo: 'deposit credited',
    entries: [
      { walletId, amountMicros: creditedMicros },
      { walletId: 'sys:real:fee_income', amountMicros: feeMicros },
      { walletId: 'sys:real:external_reserve', amountMicros: -amountMicros },
    ],
    now,
  })
  repos.funding.creditDeposit({
    id: deposit.id,
    scamTxId: tx.id,
    receivedMicros: amountMicros,
    feeMicros,
    creditedMicros,
    raw: JSON.stringify(tx),
    now,
  })
  repos.runtime.addNotification(
    deposit.userId,
    'deposit.credited',
    { depositId: deposit.id, amount: fromMicros(creditedMicros, 4) },
    now,
  )
  if (amountMicros !== deposit.amountMicros) {
    repos.runtime.audit({
      actorId: null,
      action: 'deposit.amount_mismatch',
      target: deposit.id,
      before: { declared: deposit.amountMicros.toString() },
      after: { received: amountMicros.toString() },
      ip: null,
      now,
    })
  }
  return { status: 'credited', depositId: deposit.id }
}
