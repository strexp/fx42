import { describe, expect, it } from 'vitest'
import { loadConfig } from '@fx42/config'
import { AesGcmCrypto, MOCK_RESERVE_IBAN, MOCK_RESERVE_TOKEN, MockScamClient } from '@fx42/clients'
import {
  createVirtualDeposit,
  liquidatePosition,
  placeOrder,
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

describe('liquidation', () => {
  it('force-closes a 1000x position, records liquidation and keeps the ledger balanced', () => {
    const now = Date.UTC(2026, 9, 29, 12, 0, 0)
    const db = tempDb()
    seedDemoUsers(db, now)
    const clock = { now: () => now }
    const repos = new DbRepos(db, clock)
    const loaded = loadConfig({
      filePath: 'config/fx42.mock.yaml',
      env: { NODE_ENV: 'test' },
      checkSecrets: false,
    })
    const state = { mid: 1.115 }
    const prices: PricePort = {
      get: (symbol) => {
        if (symbol !== 'EURUSD') return null
        return {
          symbol,
          bid: (state.mid - 0.0001).toFixed(5),
          ask: (state.mid + 0.0001).toFixed(5),
          mid: state.mid.toFixed(5),
          quoteToUsd: '1',
          marketState: 'open',
          stale: false,
          quoteAgeMs: 50,
          feedGapMs: 50,
          spreadSpike: false,
          sourceTs: now,
          updatedAt: now,
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
    const user = repos.users.findUserByMnt('ALICE-MNT')!
    createVirtualDeposit(ctx, user.id, { amount: '100000', requestId: 'liq-dep-1' })
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '1',
      leverage: 1000,
      clientOrderId: 'liq-order-1',
    })
    expect(opened.position!.status).toBe('open')
    state.mid = 1.1
    const result = liquidatePosition(ctx, opened.position!.id, opened.position!.version)
    expect(result.liquidated).toBe(true)
    const closed = repos.trading.findPositionById(opened.position!.id)!
    expect(closed.status).toBe('liquidated')
    expect(closed.closeReason).toBe('liquidation')
    const liquidations = db.raw.prepare('SELECT * FROM liquidations').all()
    expect(liquidations).toHaveLength(1)
    expect(repos.runtime.listNotifications(user.id, 50).some((n) => n.kind === 'liquidation')).toBe(
      true,
    )
    expect(reconcile(repos).ok).toBe(true)
    expect(repos.wallets.systemBalance('virtual', 'bad_debt')).toBeLessThanOrEqual(0n)
    db.close()
  })
})
