import { describe, expect, it } from 'vitest'
import { loadConfig } from '@fx42/config'
import {
  AesGcmCrypto,
  MOCK_ALICE_TOKEN,
  MOCK_RESERVE_IBAN,
  MOCK_RESERVE_TOKEN,
  MockScamClient,
} from '@fx42/clients'
import {
  bindScamToken,
  createAutoDeposit,
  type AppContext,
  type PricePort,
} from '@fx42/application'
import { DbRepos, SqliteUnitOfWork, createMemoryDb, reconcile, seedDemoUsers } from '../src'

describe('automatic deposit', () => {
  it('pulls funds from a bound account with the user token and credits immediately', async () => {
    const now = Date.UTC(2026, 9, 29, 12, 0, 0)
    const db = createMemoryDb()
    seedDemoUsers(db, now)
    const clock = { now: () => now }
    const repos = new DbRepos(db, clock)
    const loaded = loadConfig({
      filePath: 'config/fx42.mock.yaml',
      env: { NODE_ENV: 'test' },
      checkSecrets: false,
    })
    const prices: PricePort = { get: () => null, all: () => [] }
    const ctx: AppContext = {
      repos,
      uow: new SqliteUnitOfWork(db, clock),
      config: loaded.config,
      clock,
      prices,
      scam: new MockScamClient(),
      crypto: new AesGcmCrypto(Buffer.alloc(32, 7).toString('base64')),
      reserve: { iban: MOCK_RESERVE_IBAN, token: MOCK_RESERVE_TOKEN, scamAccountId: null },
    }
    const user = repos.users.findUserByMnt('ALICE-MNT')!
    const bound = await bindScamToken(ctx, user.id, MOCK_ALICE_TOKEN, { ip: null })
    const source = bound.accounts[0]!
    expect(source).toBeDefined()

    const deposit = await createAutoDeposit(ctx, user.id, {
      accountId: source.id,
      amount: '100',
      requestId: 'auto-deposit-1',
    })
    expect(deposit.status).toBe('credited')
    expect(deposit.creditedMicros).toBe(10_000_000_000n)
    const realAccount = repos.users.findAccountByUserMode(user.id, 'real')!
    expect(repos.wallets.findUserWallet(realAccount.id)!.balanceMicros).toBe(10_000_000_000n)
    expect(reconcile(repos).ok).toBe(true)

    const duplicate = await createAutoDeposit(ctx, user.id, {
      accountId: source.id,
      amount: '100',
      requestId: 'auto-deposit-1',
    })
    expect(duplicate.id).toBe(deposit.id)
    expect(repos.wallets.findUserWallet(realAccount.id)!.balanceMicros).toBe(10_000_000_000n)
    db.close()
  })
})

describe('deposit daily limit scoping', () => {
  it('sums real and virtual deposits separately for the same user', () => {
    const now = Date.UTC(2026, 9, 29, 12, 0, 0)
    const db = createMemoryDb()
    seedDemoUsers(db, now)
    const repos = new DbRepos(db, { now: () => now })
    const user = repos.users.findUserByMnt('ALICE-MNT')!
    const real = repos.users.findAccountByUserMode(user.id, 'real')!
    const virtual = repos.users.findAccountByUserMode(user.id, 'virtual')!
    const create = (accountId: string, mode: 'real' | 'virtual', amountMicros: bigint) =>
      repos.funding.createDeposit({
        userId: user.id,
        accountId,
        mode,
        method: mode === 'real' ? 'transfer' : 'virtual',
        amountMicros,
        requestId: null,
        memoCode: null,
        expiresAt: null,
        status: 'credited',
        now,
      })
    create(real.id, 'real', 100n)
    create(virtual.id, 'virtual', 200n)
    expect(repos.funding.sumDepositAmountSince(user.id, 'real', 0)).toBe(100n)
    expect(repos.funding.sumDepositAmountSince(user.id, 'virtual', 0)).toBe(200n)
    db.close()
  })
})
