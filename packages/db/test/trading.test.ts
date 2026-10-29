import { describe, expect, it } from 'vitest'
import { loadConfig } from '@fx42/config'
import { AesGcmCrypto, MOCK_RESERVE_IBAN, MOCK_RESERVE_TOKEN, MockScamClient } from '@fx42/clients'
import {
  autoClosePosition,
  checkTriggers,
  closePosition,
  createVirtualDeposit,
  notifyRiskLevels,
  placeOrder,
  previewOrder,
  setAutoClose,
  setTpSl,
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

function setup() {
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
  createVirtualDeposit(ctx, user.id, { amount: '1000000', requestId: 'trade-dep-1' })
  return { db, repos, ctx, user, state }
}

describe('order lifecycle', () => {
  it('increases, partially closes and flips while keeping the ledger balanced', () => {
    const { db, repos, ctx, user } = setup()
    const first = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'trade-open-1',
    })
    const increased = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'trade-inc-1',
    })
    expect(increased.position!.unitsMicros).toBe(20_000_00000000n)
    expect(Number(increased.position!.entryPrice)).toBeCloseTo(
      Number(first.position!.entryPrice),
      5,
    )

    const reduced = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'trade-reduce-1',
    })
    expect(reduced.position!.unitsMicros).toBe(10_000_00000000n)

    const flipped = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      lots: '0.2',
      leverage: 100,
      clientOrderId: 'trade-flip-1',
    })
    expect(flipped.position!.side).toBe('short')
    expect(flipped.position!.unitsMicros).toBe(10_000_00000000n)
    expect(reconcile(repos).ok).toBe(true)
    db.close()
  })

  it('applies opening gates to the new leg of a flip', () => {
    const { db, repos, ctx, user } = setup()
    placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'flip-gate-open-1',
    })
    repos.runtime.setFlag('halt_opening', '1', 'test', 'test', ctx.clock.now())
    expect(() =>
      placeOrder(ctx, user.id, {
        mode: 'virtual',
        symbol: 'EURUSD',
        side: 'short',
        lots: '0.2',
        leverage: 100,
        clientOrderId: 'flip-gate-halted-1',
      }),
    ).toThrow(/Trading is temporarily halted/)

    repos.runtime.setFlag('halt_opening', '0', 'test', 'test', ctx.clock.now())
    const flipped = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      lots: '0.2',
      leverage: 100,
      clientOrderId: 'flip-gate-open-2',
    })
    expect(flipped.position!.side).toBe('short')
    expect(flipped.position!.unitsMicros).toBe(10_000_00000000n)
    db.close()
  })

  it('rejects an auto-close ratio at or above 90% of the current margin ratio', () => {
    const { db, ctx, user } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'auto-close-open-1',
    })
    const positionId = opened.position!.id
    expect(() => setAutoClose(ctx, user.id, positionId, { autoCloseRatio: '1.9' })).toThrow(
      /validation/i,
    )
    const updated = setAutoClose(ctx, user.id, positionId, { autoCloseRatio: '1.5' })
    expect(updated.autoCloseRatioBps).toBe(15_000)
    expect(
      setAutoClose(ctx, user.id, positionId, { autoCloseRatio: null }).autoCloseRatioBps,
    ).toBeNull()
    db.close()
  })

  it('partially closes, preserves TP/SL, is idempotent and then fully closes', () => {
    const { db, repos, ctx, user } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.2',
      leverage: 100,
      clientOrderId: 'partial-open-1',
    })
    const positionId = opened.position!.id
    const entry = Number(opened.position!.entryPrice)
    setTpSl(ctx, user.id, positionId, {
      takeProfit: (entry + 0.01).toFixed(5),
      stopLoss: (entry - 0.01).toFixed(5),
    })

    const partial = closePosition(ctx, user.id, positionId, {
      units: '5000',
      clientOrderId: 'partial-close-1',
    })
    expect(partial.fullyClosed).toBe(false)
    expect(partial.closedUnits).toBe('5000')
    expect(partial.remainingUnits).toBe('15000')
    expect(partial.order.reduceOnly).toBe(true)
    expect(repos.trading.findPositionById(positionId)!.unitsMicros).toBe(15_000_00000000n)
    expect(repos.trading.findPositionById(positionId)!.marginMicros).toBeLessThan(
      opened.position!.marginMicros,
    )
    expect(repos.trading.listActiveTriggers(positionId)).toHaveLength(2)
    const fill = repos.trading
      .listFillsByPosition(positionId)
      .find((f) => f.orderId === partial.order.id)
    expect(fill?.action).toBe('reduce')

    const replay = closePosition(ctx, user.id, positionId, {
      units: '1000',
      clientOrderId: 'partial-close-1',
    })
    expect(replay.order.id).toBe(partial.order.id)
    expect(repos.trading.findPositionById(positionId)!.unitsMicros).toBe(15_000_00000000n)

    const full = closePosition(ctx, user.id, positionId, {
      units: '15000',
      clientOrderId: 'full-close-1',
    })
    expect(full.fullyClosed).toBe(true)
    expect(full.position).toBeNull()
    expect(repos.trading.findPositionById(positionId)!.status).toBe('closed')
    expect(repos.trading.listActiveTriggers(positionId)).toHaveLength(0)
    const closeNotices = repos.runtime
      .listNotifications(user.id, 50)
      .filter((n) => n.kind === 'position.closed')
    expect(closeNotices).toHaveLength(2)
    expect(
      closeNotices.some(
        (n) =>
          JSON.parse(n.payload).reason === 'manual' && JSON.parse(n.payload).fullyClosed === true,
      ),
    ).toBe(true)
    expect(reconcile(repos).ok).toBe(true)
    db.close()
  })

  it('previews increase, reduce, close and flip against the existing position', () => {
    const { db, ctx, user } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'preview-open-1',
    })
    const position = opened.position!

    const increase = previewOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'preview',
    })
    expect(increase.action).toBe('increase')
    expect(increase.existingUnits).toBe('10000')
    expect(increase.resultingUnits).toBe('20000')
    expect(Number(increase.resultingMargin)).toBeCloseTo(
      Number(position.marginMicros) / 1e8 + Number(increase.margin),
      8,
    )
    expect(increase.liquidationPrice).not.toBeNull()

    const reduce = previewOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      lots: '0.05',
      leverage: 100,
      clientOrderId: 'preview',
    })
    expect(reduce.action).toBe('reduce')
    expect(reduce.resultingUnits).toBe('5000')
    expect(reduce.realizedPnl).not.toBeNull()
    expect(Number(reduce.closeFee)).toBeGreaterThan(0)
    expect(Number(reduce.margin)).toBeGreaterThan(0)
    expect(reduce.liquidationPrice).not.toBeNull()

    const close = previewOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'preview',
    })
    expect(close.action).toBe('close')
    expect(close.resultingUnits).toBe('0')
    expect(close.resultingEntryPrice).toBeNull()
    expect(close.liquidationPrice).toBeNull()

    const flip = previewOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      lots: '0.2',
      leverage: 100,
      clientOrderId: 'preview',
    })
    expect(flip.action).toBe('flip')
    expect(flip.resultingUnits).toBe('10000')
    expect(flip.resultingEntryPrice).toBe(flip.fillPrice)
    expect(Number(flip.openFee)).toBeGreaterThan(0)
    expect(Number(flip.closeFee)).toBeGreaterThan(0)
    expect(flip.liquidationPrice).not.toBeNull()

    db.close()
  })

  it('applies take profit when increasing an existing position', () => {
    const { db, repos, ctx, user } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'increase-tp-open-1',
    })
    const entry = Number(opened.position!.entryPrice)
    const increased = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      takeProfit: (entry + 0.02).toFixed(5),
      clientOrderId: 'increase-tp-add-1',
    })
    const triggers = repos.trading.listActiveTriggers(increased.position!.id)
    expect(triggers.map((t) => t.kind)).toContain('tp')
    db.close()
  })

  it('rejects over-close and off-step partial closes', () => {
    const { db, ctx, user } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.2',
      leverage: 100,
      clientOrderId: 'partial-invalid-1',
    })
    const positionId = opened.position!.id

    expect(() => closePosition(ctx, user.id, positionId, { units: '25000' })).toThrow(
      'INVALID_UNITS',
    )
    expect(() => closePosition(ctx, user.id, positionId, { units: '1500' })).toThrow(
      'INVALID_UNITS',
    )
    db.close()
  })

  it('blocks a partial close that would create negative equity', () => {
    const { db, repos, ctx, user, state } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'partial-baddebt-1',
    })
    state.mid = 0.9
    expect(() =>
      closePosition(ctx, user.id, opened.position!.id, {
        units: '5000',
        clientOrderId: 'partial-baddebt-close-1',
      }),
    ).toThrow(/negative equity/)
    expect(repos.trading.findPositionById(opened.position!.id)!.status).toBe('open')
    db.close()
  })

  it('does not create another margin alert while one is unread', () => {
    const { db, repos, ctx, user } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'trade-risk-1',
    })
    const positionId = opened.position!.id
    const version = opened.position!.version
    notifyRiskLevels(ctx, [{ positionId, kind: 'warning', ratio: '1.8000', version }])
    notifyRiskLevels(ctx, [{ positionId, kind: 'danger', ratio: '1.4000', version }])
    const unread = repos.runtime
      .listNotifications(user.id, 50)
      .filter((n) => n.kind.startsWith('margin.'))
    expect(unread).toHaveLength(1)
    expect(unread[0]!.kind).toBe('margin.warning')

    repos.runtime.markNotificationsRead(user.id, ctx.clock.now())
    notifyRiskLevels(ctx, [{ positionId, kind: 'danger', ratio: '1.4000', version }])
    const afterRead = repos.runtime
      .listNotifications(user.id, 50)
      .filter((n) => n.kind.startsWith('margin.'))
    expect(afterRead.map((n) => n.kind)).toContain('margin.danger')
    db.close()
  })

  it('triggers TP for a short and closes only once', () => {
    const { db, repos, ctx, user, state } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'short',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'trade-tp-1',
    })
    const entry = Number(opened.position!.entryPrice)
    setTpSl(ctx, user.id, opened.position!.id, { takeProfit: (entry - 0.005).toFixed(5) })
    state.mid = entry - 0.01
    const triggered = checkTriggers(ctx)
    expect(triggered).toHaveLength(1)
    expect(triggered[0]!.kind).toBe('tp')
    expect(repos.trading.findPositionById(opened.position!.id)!.status).toBe('closed')
    expect(checkTriggers(ctx)).toHaveLength(0)
    const closedNotice = repos.runtime
      .listNotifications(user.id, 50)
      .find((n) => n.kind === 'position.closed')
    expect(closedNotice).toBeDefined()
    expect(JSON.parse(closedNotice!.payload).reason).toBe('tp')
    expect(reconcile(repos).ok).toBe(true)
    db.close()
  })

  it('notifies when an auto-close ratio is hit', () => {
    const { db, repos, ctx, user, state } = setup()
    const opened = placeOrder(ctx, user.id, {
      mode: 'virtual',
      symbol: 'EURUSD',
      side: 'long',
      lots: '0.1',
      leverage: 100,
      clientOrderId: 'auto-notify-1',
    })
    const positionId = opened.position!.id
    setAutoClose(ctx, user.id, positionId, { autoCloseRatio: '1.5' })
    state.mid = Number(opened.position!.entryPrice) * 0.997
    expect(autoClosePosition(ctx, positionId)).toBe(true)
    const notice = repos.runtime
      .listNotifications(user.id, 50)
      .find((n) => n.kind === 'position.closed')
    expect(notice).toBeDefined()
    const payload = JSON.parse(notice!.payload)
    expect(payload.reason).toBe('auto')
    expect(payload.fullyClosed).toBe(true)
    expect(repos.trading.findPositionById(positionId)!.status).toBe('closed')
    db.close()
  })
})
