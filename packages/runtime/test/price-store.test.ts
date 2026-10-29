import { describe, expect, it } from 'vitest'
import { PriceStore } from '../src/price-store'

describe('PriceStore feed gap', () => {
  it('uses local receipt time instead of a lagging upstream source timestamp', () => {
    const store = new PriceStore()
    const receivedAt = 1_000_000
    store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10000',
        ask: '1.10010',
        mid: '1.10005',
        sourceTs: receivedAt - 70_000,
        quoteAgeSeconds: 0,
      },
      receivedAt,
    )
    const next = store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10010',
        ask: '1.10020',
        mid: '1.10015',
        sourceTs: receivedAt - 69_500,
        quoteAgeSeconds: 0,
      },
      receivedAt + 500,
    )
    expect(next?.feedGapMs).toBe(500)
  })

  it('grows the local feed gap while ticks stop arriving', () => {
    const store = new PriceStore()
    const receivedAt = 1_000_000
    store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10000',
        ask: '1.10010',
        mid: '1.10005',
        sourceTs: receivedAt - 70_000,
        quoteAgeSeconds: 0,
      },
      receivedAt,
    )
    store.refreshAges(receivedAt + 16_000)
    expect(store.get('EURUSD', receivedAt + 16_000)?.feedGapMs).toBe(16_000)
  })
})

describe('PriceStore market state', () => {
  it('applies authoritative metadata even when the snapshot quote is older', () => {
    const store = new PriceStore()
    const now = 1_000_000
    store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.11595',
        ask: '1.11609',
        mid: '1.11602',
        marketState: 'open',
        stale: false,
        quoteAgeSeconds: 0,
        sourceTs: now,
      },
      now,
    )
    const snapshot = store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.11597',
        ask: '1.11611',
        mid: '1.11604',
        marketState: 'closed',
        stale: true,
        quoteAgeSeconds: 20_000,
        sourceTs: now - 9_000,
      },
      now + 1_000,
    )
    expect(snapshot?.marketState).toBe('closed')
    expect(snapshot?.stale).toBe(true)
    // Price must not regress to the older snapshot.
    expect(snapshot?.sourceTs).toBe(now)
    expect(snapshot?.bid).toBe('1.11595')
  })

  it('treats a quote frozen beyond closedAfterMs as closed', () => {
    const store = new PriceStore(30_000, 60_000)
    const now = 1_000_000
    store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10000',
        ask: '1.10010',
        mid: '1.10005',
        marketState: 'open',
        stale: false,
        quoteAgeSeconds: 0,
        sourceTs: now,
      },
      now,
    )
    expect(store.get('EURUSD', now + 30_000)?.marketState).toBe('open')
    const frozen = store.get('EURUSD', now + 61_000)
    expect(frozen?.marketState).toBe('closed')
    expect(frozen?.stale).toBe(true)
  })

  it('treats upstream open with a long quote age as closed', () => {
    const store = new PriceStore()
    const now = 10_000_000
    const snapshot = store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10000',
        ask: '1.10010',
        mid: '1.10005',
        // Production biquote observed on weekends: says "open" but the last
        // quote is hours old.
        marketState: 'open',
        stale: true,
        quoteAgeSeconds: 20_956,
        sourceTs: now - 20_956_000,
      },
      now,
    )
    expect(snapshot?.marketState).toBe('closed')
    expect(snapshot?.stale).toBe(true)
  })

  it('treats a startup replay of an old tick as closed', () => {
    const store = new PriceStore()
    const now = 10_000_000
    const snapshot = store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10000',
        ask: '1.10010',
        mid: '1.10005',
        // SignalR replay after a restart: no quoteAgeSeconds, frozen timestamp.
        sourceTs: now - 60 * 60_000,
      },
      now,
    )
    expect(snapshot?.marketState).toBe('closed')
    expect(snapshot?.stale).toBe(true)
  })

  it('stays closed when a replay has a newer but still old timestamp', () => {
    const store = new PriceStore()
    const now = 10_000_000
    store.apply(
      {
        symbol: 'GBPUSD',
        bid: '1.33885',
        ask: '1.33912',
        mid: '1.338985',
        marketState: 'open',
        stale: false,
        quoteAgeSeconds: 1,
        sourceTs: now - 1_000,
      },
      now,
    )
    // Reconnect replays a tick whose sourceTs is newer than the stored one but
    // still hours old; quoteAgeSeconds is absent on SignalR payloads.
    const snapshot = store.apply(
      {
        symbol: 'GBPUSD',
        bid: '1.33883',
        ask: '1.33910',
        mid: '1.338965',
        sourceTs: now + 5_000,
      },
      now + 10 * 60_000,
    )
    expect(snapshot?.marketState).toBe('closed')
    expect(snapshot?.stale).toBe(true)
  })

  it('does not reset quote age when the same tick is replayed', () => {
    const store = new PriceStore()
    const now = 1_000_000
    store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10000',
        ask: '1.10010',
        mid: '1.10005',
        sourceTs: now,
      },
      now,
    )
    // SignalR reconnect replays the same frozen tick with no quoteAgeSeconds.
    store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.10000',
        ask: '1.10010',
        mid: '1.10005',
        sourceTs: now,
      },
      now + 10_000,
    )
    expect(store.get('EURUSD', now + 10_000)?.quoteAgeMs).toBe(10_000)
    expect(store.get('EURUSD', now + 31_000)?.stale).toBe(true)
  })

  it('suppresses a spread spike once the quote is stale', () => {
    const store = new PriceStore(30_000, 5 * 60_000)
    const start = 1_000_000
    for (let i = 0; i < 6; i++) {
      store.apply(
        {
          symbol: 'EURUSD',
          bid: '1.10000',
          ask: '1.10010',
          mid: '1.10005',
          sourceTs: start + i * 1_000,
          quoteAgeSeconds: 0,
        },
        start + i * 1_000,
      )
    }
    const spiked = store.apply(
      {
        symbol: 'EURUSD',
        bid: '1.09900',
        ask: '1.10100',
        mid: '1.10000',
        sourceTs: start + 6_000,
        quoteAgeSeconds: 0,
      },
      start + 6_000,
    )
    expect(spiked?.spreadSpike).toBe(true)
    // No new quotes arrive; after the stale threshold the spike is irrelevant.
    expect(store.get('EURUSD', start + 40_000)?.spreadSpike).toBe(false)
  })
})
