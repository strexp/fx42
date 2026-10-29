import { describe, expect, it } from 'vitest'
import { loadConfig } from '@fx42/config'
import {
  AesGcmCrypto,
  MOCK_RESERVE_IBAN,
  MOCK_RESERVE_TOKEN,
  MockScamClient,
} from '@fx42/clients'
import {
  createVirtualDeposit,
  placeOrder,
  closePosition,
  type AppContext,
  type PricePort,
} from '@fx42/application'
import {
  DbRepos,
  SqliteUnitOfWork,
  createMemoryDb,
  reconcile,
  seedDemoUsers,
  type Fx42Db,
} from '../src'

function tempDb(): Fx42Db {
  return createMemoryDb()
}

function setupUser(db: Fx42Db) {
  const clock = { now: () => Date.UTC(2026, 9, 29, 12, 0, 0) }
  const repos = new DbRepos(db, clock)
  const uow = new SqliteUnitOfWork(db, clock)
  const result = uow.run((r) => {
    const user = r.users.createUser({
      activeMnt: 'ALICE-MNT',
      displayName: 'Alice',
      email: 'alice@example.dn42',
      locale: 'zh-CN',
      now: clock.now(),
    })
    r.users.createTerms(user.id, 'virtual', null, null, clock.now())
    r.users.createAccount(user.id, 'real', clock.now())
    const virtual = r.users.createAccount(user.id, 'virtual', clock.now())
    r.users.completeOnboarding(user.id, 'virtual', clock.now())
    return { user, virtual }
  })
  return { clock, repos, uow, ...result }
}

describe('SQLite ledger', () => {
  it('posts a balanced transaction and reconciles', () => {
    const db = tempDb()
    const { repos, clock, virtual } = setupUser(db)
    const wallet = repos.wallets.findUserWallet(virtual.id)!
    new SqliteUnitOfWork(db, clock).run((r) =>
      r.wallets.postLedger({
        mode: 'virtual',
        type: 'deposit',
        refType: 'test',
        entries: [
          { walletId: wallet.id, amountMicros: 100_000_000_00n },
          { walletId: 'sys:virtual:external_reserve', amountMicros: -100_000_000_00n },
        ],
        now: clock.now(),
      }),
    )
    expect(repos.wallets.findUserWallet(virtual.id)!.balanceMicros).toBe(100_000_000_00n)
    const report = reconcile(repos)
    expect(report.ok).toBe(true)
    db.close()
  })

  it('rejects unbalanced transactions before writing entries', () => {
    const db = tempDb()
    const { repos, clock, virtual } = setupUser(db)
    const wallet = repos.wallets.findUserWallet(virtual.id)!
    expect(() =>
      new SqliteUnitOfWork(db, clock).run((r) =>
        r.wallets.postLedger({
          mode: 'virtual',
          type: 'deposit',
          refType: 'test',
          entries: [
            { walletId: wallet.id, amountMicros: 100n },
            { walletId: 'sys:virtual:external_reserve', amountMicros: -99n },
          ],
          now: clock.now(),
        }),
      ),
    ).toThrow(/unbalanced/)
    const count = db.raw.prepare('SELECT count(*) AS c FROM ledger_txs').get() as { c: bigint }
    expect(Number(count.c)).toBe(0)
    db.close()
  })

  it('rejects mixed real/virtual wallets', () => {
    const db = tempDb()
    const { repos, clock, virtual } = setupUser(db)
    const wallet = repos.wallets.findUserWallet(virtual.id)!
    expect(() =>
      new SqliteUnitOfWork(db, clock).run((r) =>
        r.wallets.postLedger({
          mode: 'real',
          type: 'deposit',
          refType: 'test',
          entries: [
            { walletId: wallet.id, amountMicros: 100n },
            { walletId: 'sys:real:external_reserve', amountMicros: -100n },
          ],
          now: clock.now(),
        }),
      ),
    ).toThrow(/mode mismatch/)
    db.close()
  })

  it('detects unread notifications for a position', () => {
    const db = tempDb()
    const { repos, clock, user } = setupUser(db)
    repos.runtime.addNotification(
      user.id,
      'margin.warning',
      { positionId: 'position-1', symbol: 'EURUSD', ratio: '1.5000' },
      clock.now(),
    )
    expect(repos.runtime.hasUnreadNotificationForPosition(user.id, 'position-1', 'margin.')).toBe(
      true,
    )
    expect(repos.runtime.hasUnreadNotificationForPosition(user.id, 'position-2', 'margin.')).toBe(
      false,
    )
    expect(repos.runtime.hasUnreadNotificationForPosition(user.id, 'position-1', 'weekend.')).toBe(
      false,
    )
    repos.runtime.markNotificationsRead(user.id, clock.now())
    expect(repos.runtime.hasUnreadNotificationForPosition(user.id, 'position-1', 'margin.')).toBe(
      false,
    )
    db.close()
  })

  it('makes ledger entries immutable', () => {
    const db = tempDb()
    const { repos, clock, virtual } = setupUser(db)
    const wallet = repos.wallets.findUserWallet(virtual.id)!
    new SqliteUnitOfWork(db, clock).run((r) =>
      r.wallets.postLedger({
        mode: 'virtual',
        type: 'deposit',
        refType: 'test',
        entries: [
          { walletId: wallet.id, amountMicros: 100n },
          { walletId: 'sys:virtual:external_reserve', amountMicros: -100n },
        ],
        now: clock.now(),
      }),
    )
    expect(() => db.raw.prepare('UPDATE ledger_entries SET amount_micros = 1').run()).toThrow()
    expect(() => db.raw.prepare('DELETE FROM ledger_entries').run()).toThrow()
    db.close()
  })

  it('seeds system wallets for both modes', () => {
    const db = tempDb()
    const rows = db.raw
      .prepare('SELECT mode, kind, allow_negative FROM wallets WHERE account_id IS NULL')
      .all() as Array<{
      mode: string
      kind: string
      allow_negative: bigint
    }>
    expect(rows.filter((r) => r.mode === 'real')).toHaveLength(7)
    expect(rows.filter((r) => r.mode === 'virtual')).toHaveLength(7)
    expect(rows.find((r) => r.kind === 'bad_debt' && r.mode === 'real')!.allow_negative).toBe(1n)
    db.close()
  })

  it('runs the virtual deposit → order → close flow with a balanced ledger', async () => {
    const db = tempDb()
    seedDemoUsers(db, Date.UTC(2026, 9, 29, 12, 0, 0))
    const clock = { now: () => Date.UTC(2026, 9, 29, 12, 0, 0) }
    const repos = new DbRepos(db, clock)
    const loaded = loadConfig({
      filePath: 'config/fx42.mock.yaml',
      env: { NODE_ENV: 'test' },
      checkSecrets: false,
    })
    let mid = '1.11500'
    const prices: PricePort = {
      get: (symbol) => {
        if (symbol !== 'EURUSD') return null
        const m = Number(mid)
        return {
          symbol,
          bid: (m - 0.0001).toFixed(5),
          ask: (m + 0.0001).toFixed(5),
          mid,
          quoteToUsd: '1',
          marketState: 'open',
          stale: false,
          quoteAgeMs: 100,
          feedGapMs: 100,
          spreadSpike: false,
          sourceTs: clock.now(),
          updatedAt: clock.now(),
        }
      },
      all: () => [],
    }
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
    const alice = repos.users.findUserByMnt('ALICE-MNT')!
    createVirtualDeposit(ctx, alice.id, { amount: '1000000', requestId: 'req-deposit-1' })
    const before = repos.wallets.findUserWallet(
      repos.users.findAccountByUserMode(alice.id, 'virtual')!.id,
    )!.balanceMicros
    expect(before).toBe(200_000_000_000_000n)

    const opened = placeOrder(ctx, alice.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '1',
      leverage: 100,
      clientOrderId: 'test-order-1',
    })
    expect(opened.position).not.toBeNull()
    expect(opened.position!.unitsMicros).toBe(100_000_00000000n)
    expect(reconcile(repos).ok).toBe(true)

    mid = '1.11700'
    const closed = closePosition(ctx, alice.id, opened.position!.id, { reason: 'manual' })
    expect(Number(closed.realized)).toBeGreaterThan(15_000)
    expect(reconcile(repos).ok).toBe(true)
    const after = repos.wallets.findUserWallet(
      repos.users.findAccountByUserMode(alice.id, 'virtual')!.id,
    )!.balanceMicros
    expect(after).toBeGreaterThan(before - 120_000_00000000n)
    db.close()
  })
})
