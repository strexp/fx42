import Decimal from 'decimal.js'
import { AppError, dec, fromMicros, toMicros, withdrawalRef } from '@fx42/shared'
import { withdrawalPreview } from '@fx42/domain'
import { getAccount, utcDayStart } from '../helpers'
import type { FundingContext } from '../ports'
import { ScamError } from '../ports'
import type { WithdrawalRow } from '@fx42/db'
import { resolveReserveAccount } from './credentials'

export function createWithdrawal(
  ctx: FundingContext,
  userId: string,
  input:
    | { mode: 'real'; amount: string; destinationAccountId: string; requestId: string }
    | { mode: 'virtual'; amount: string; requestId: string },
): WithdrawalRow {
  const account = getAccount(ctx, userId, input.mode)
  const existing = ctx.repos.funding.findWithdrawalByKey(input.requestId)
  if (existing) return existing
  const amount = dec(input.amount)
  const now = ctx.clock.now()

  if (input.mode === 'virtual') {
    const wallet = ctx.repos.wallets.findUserWallet(account.id)
    const amountMicros = toMicros(amount)
    if (!wallet || wallet.balanceMicros < amountMicros) throw new AppError('INSUFFICIENT_BALANCE')
    return ctx.uow.run((repos) => {
      const duplicate = repos.funding.findWithdrawalByKey(input.requestId)
      if (duplicate) return duplicate
      const row = repos.funding.createWithdrawal({
        userId,
        accountId: account.id,
        mode: 'virtual',
        amountMicros,
        feeMicros: 0n,
        netMicros: amountMicros,
        destinationAccountId: null,
        destinationIban: null,
        status: 'settled',
        idempotencyKey: input.requestId,
        scamRef: null,
        now,
      })
      repos.wallets.postLedger({
        mode: 'virtual',
        type: 'withdrawal',
        refType: 'withdrawal',
        refId: row.id,
        memo: 'virtual withdrawal',
        entries: [
          { walletId: repos.wallets.walletIdForAccount(account.id), amountMicros: -amountMicros },
          { walletId: 'sys:virtual:external_reserve', amountMicros },
        ],
        now,
      })
      return repos.funding.findWithdrawalById(row.id)!
    })
  }

  const credential = ctx.repos.credentials.findActiveCredential(userId)
  if (!credential) throw new AppError('TOKEN_REQUIRED')
  const destination = ctx.repos.credentials.findScamAccount(input.destinationAccountId)
  const destCredential = destination
    ? ctx.repos.credentials.findCredentialById(destination.credentialId)
    : null
  if (
    !destination ||
    !destCredential ||
    destCredential.userId !== userId ||
    destCredential.status !== 'active'
  ) {
    throw new AppError('DESTINATION_FORBIDDEN')
  }
  const preview = withdrawalPreviewFor(ctx, amount)
  if (!preview) throw new AppError('VALIDATION_ERROR', { message: 'withdrawal amount too small' })
  if (
    amount.lt(dec(ctx.config.funding.minWithdraw)) ||
    amount.gt(dec(ctx.config.funding.maxWithdraw))
  ) {
    throw new AppError('DEPOSIT_LIMIT', {
      details: { min: ctx.config.funding.minWithdraw, max: ctx.config.funding.maxWithdraw },
    })
  }
  const dayStart = utcDayStart(now)
  const used = ctx.repos.funding.sumWithdrawnSince(userId, 'real', dayStart)
  if (used + preview.amountMicros > toMicros(ctx.config.funding.maxWithdrawPerDay)) {
    throw new AppError('DEPOSIT_LIMIT', { message: 'daily withdrawal limit reached' })
  }
  const wallet = ctx.repos.wallets.findUserWallet(account.id)
  if (!wallet || wallet.balanceMicros < preview.amountMicros)
    throw new AppError('INSUFFICIENT_BALANCE')
  const scamRef = withdrawalRef()

  return ctx.uow.run((repos) => {
    const duplicate = repos.funding.findWithdrawalByKey(input.requestId)
    if (duplicate) return duplicate
    const freshWallet = repos.wallets.findUserWallet(account.id)
    if (!freshWallet || freshWallet.balanceMicros < preview.amountMicros) {
      throw new AppError('INSUFFICIENT_BALANCE')
    }
    const row = repos.funding.createWithdrawal({
      userId,
      accountId: account.id,
      mode: 'real',
      amountMicros: preview.amountMicros,
      feeMicros: preview.feeMicros,
      netMicros: preview.netMicros,
      destinationAccountId: destination.id,
      destinationIban: destination.iban,
      status: 'requested',
      idempotencyKey: input.requestId,
      scamRef,
      now,
    })
    repos.wallets.postLedger({
      mode: 'real',
      type: 'withdrawal',
      refType: 'withdrawal',
      refId: row.id,
      memo: 'withdrawal requested',
      entries: [
        { walletId: freshWallet.id, amountMicros: -preview.amountMicros },
        { walletId: 'sys:real:withdrawal_pending', amountMicros: preview.amountMicros },
      ],
      now,
    })
    repos.jobs.enqueueJob({
      type: 'withdrawal-execute',
      payload: { withdrawalId: row.id },
      dedupeKey: row.id,
      priority: 10,
      now,
    })
    repos.runtime.audit({
      actorId: userId,
      action: 'withdrawal.create',
      target: row.id,
      before: null,
      after: { amount: amount.toString(), net: preview.net.toString(), scamRef },
      ip: null,
      now,
    })
    return repos.funding.findWithdrawalById(row.id)!
  })
}

export function withdrawalPreviewFor(
  ctx: FundingContext,
  amount: Decimal,
): {
  amountMicros: bigint
  feeMicros: bigint
  netMicros: bigint
  fee: Decimal
  net: Decimal
} | null {
  return withdrawalPreview(amount, ctx.config.fees)
}

export function cancelWithdrawal(
  ctx: FundingContext,
  userId: string,
  withdrawalId: string,
): WithdrawalRow {
  const w = ctx.repos.funding.findWithdrawalById(withdrawalId)
  if (!w || w.userId !== userId) throw new AppError('FORBIDDEN')
  if (w.status !== 'requested')
    throw new AppError('VALIDATION_ERROR', {
      message: 'only requested withdrawals can be cancelled',
    })
  const now = ctx.clock.now()
  return ctx.uow.run((repos) => {
    const fresh = repos.funding.findWithdrawalById(withdrawalId)!
    if (fresh.status !== 'requested')
      throw new AppError('VALIDATION_ERROR', { message: 'withdrawal already processing' })
    const account = repos.users.findAccountById(fresh.accountId)!
    const walletId = repos.wallets.walletIdForAccount(account.id)
    repos.wallets.postLedger({
      mode: fresh.mode,
      type: 'withdrawal',
      refType: 'withdrawal',
      refId: fresh.id,
      memo: 'withdrawal cancelled',
      entries: [
        { walletId: `sys:${fresh.mode}:withdrawal_pending`, amountMicros: -fresh.amountMicros },
        { walletId, amountMicros: fresh.amountMicros },
      ],
      now,
    })
    repos.funding.setWithdrawalStatus(fresh.id, 'cancelled', { now })
    return repos.funding.findWithdrawalById(fresh.id)!
  })
}

export function markWithdrawalSending(ctx: FundingContext, withdrawalId: string): WithdrawalRow {
  return ctx.uow.run((repos) => {
    const w = repos.funding.findWithdrawalById(withdrawalId)
    if (!w) throw new AppError('VALIDATION_ERROR', { message: 'withdrawal not found' })
    if (w.status !== 'requested' && w.status !== 'sending') return w
    repos.funding.setWithdrawalStatus(w.id, 'sending', { now: ctx.clock.now() })
    return repos.funding.findWithdrawalById(w.id)!
  })
}

export function settleWithdrawalSuccess(
  ctx: FundingContext,
  withdrawalId: string,
  scamTxId: number | null,
): WithdrawalRow {
  const now = ctx.clock.now()
  return ctx.uow.run((repos) => {
    const w = repos.funding.findWithdrawalById(withdrawalId)
    if (!w) throw new AppError('VALIDATION_ERROR', { message: 'withdrawal not found' })
    if (w.status === 'sent' || w.status === 'settled') return w
    repos.wallets.postLedger({
      mode: 'real',
      type: 'withdrawal',
      refType: 'withdrawal',
      refId: w.id,
      memo: 'withdrawal sent',
      entries: [
        { walletId: 'sys:real:withdrawal_pending', amountMicros: -w.amountMicros },
        { walletId: 'sys:real:external_reserve', amountMicros: w.netMicros },
        { walletId: 'sys:real:fee_income', amountMicros: w.feeMicros },
      ],
      now,
    })
    repos.funding.setWithdrawalStatus(w.id, 'sent', { scamTxId, now })
    repos.runtime.addNotification(
      w.userId,
      'withdrawal.sent',
      { withdrawalId: w.id, net: fromMicros(w.netMicros, 4) },
      now,
    )
    return repos.funding.findWithdrawalById(w.id)!
  })
}

export function failWithdrawal(
  ctx: FundingContext,
  withdrawalId: string,
  error: string,
): WithdrawalRow {
  const now = ctx.clock.now()
  return ctx.uow.run((repos) => {
    const w = repos.funding.findWithdrawalById(withdrawalId)
    if (!w) throw new AppError('VALIDATION_ERROR', { message: 'withdrawal not found' })
    if (w.status === 'failed' || w.status === 'cancelled') return w
    const walletId = repos.wallets.walletIdForAccount(w.accountId)
    repos.wallets.postLedger({
      mode: 'real',
      type: 'withdrawal',
      refType: 'withdrawal',
      refId: w.id,
      memo: 'withdrawal refund',
      entries: [
        { walletId: 'sys:real:withdrawal_pending', amountMicros: -w.amountMicros },
        { walletId, amountMicros: w.amountMicros },
      ],
      now,
    })
    repos.funding.setWithdrawalStatus(w.id, 'failed', { error, now })
    repos.runtime.addNotification(
      w.userId,
      'withdrawal.failed',
      { withdrawalId: w.id, reason: error },
      now,
    )
    return repos.funding.findWithdrawalById(w.id)!
  })
}

export async function executeWithdrawal(
  ctx: FundingContext,
  withdrawalId: string,
): Promise<WithdrawalRow> {
  const sending = markWithdrawalSending(ctx, withdrawalId)
  if (sending.status === 'sent' || sending.status === 'settled' || sending.status === 'failed')
    return sending
  const destination = sending.destinationAccountId
    ? ctx.repos.credentials.findScamAccount(sending.destinationAccountId)
    : null
  const destCredential = destination
    ? ctx.repos.credentials.findCredentialById(destination.credentialId)
    : null
  if (
    !destination ||
    !destCredential ||
    destCredential.userId !== sending.userId ||
    destCredential.status !== 'active'
  ) {
    return failWithdrawal(ctx, withdrawalId, 'destination is no longer available')
  }
  const reserve = await resolveReserveAccount(ctx)
  let reserveBalance: Decimal
  try {
    const account = await ctx.scam.getAccount(reserve.token, reserve.scamAccountId)
    reserveBalance = dec(account.balance)
  } catch (error) {
    throw error instanceof ScamError ? error : new ScamError('reserve lookup failed', 503, false)
  }
  if (reserveBalance.lt(dec(fromMicros(sending.netMicros, 4)))) {
    // Return to requested so the worker can retry after the reserve is topped up.
    ctx.uow.run((repos) => {
      repos.funding.setWithdrawalStatus(withdrawalId, 'requested', {
        now: ctx.clock.now(),
        error: 'needs_funds',
      })
    })
    throw new AppError('RESERVE_INSUFFICIENT')
  }
  try {
    const result = await ctx.scam.transfer(reserve.token, {
      fromAccountId: reserve.scamAccountId,
      toIban: destination.iban,
      amount: fromMicros(sending.netMicros, 4),
      description: `FX42 withdrawal ${sending.scamRef}`,
      idempotencyKey: sending.id,
    })
    return settleWithdrawalSuccess(ctx, withdrawalId, result.transactionId)
  } catch (error) {
    if (error instanceof ScamError && error.definitive) {
      return failWithdrawal(ctx, withdrawalId, error.message)
    }
    throw error
  }
}
