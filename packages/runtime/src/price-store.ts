import Decimal from 'decimal.js'
import type { PriceSnapshot } from '@fx42/application'

export interface RawTick {
  symbol: string
  bid: string
  ask: string
  mid: string
  marketState?: 'open' | 'closed'
  stale?: boolean
  quoteAgeSeconds?: number
  sourceTs: number
  description?: string
}

interface StoredPrice extends PriceSnapshot {
  history: Array<{ at: number; spread: number }>
  ageAtUpdate: number
  ageAnchorAt: number
  feedGapAtUpdate: number
  feedGapAnchorAt: number
  upstreamMarketState: 'open' | 'closed'
  upstreamStale: boolean | null
}

const SPREAD_WINDOW_MS = 20 * 60_000

/**
 * A quote with an age above this threshold is treated as closed even when the
 * upstream still reports `marketState: "open"`. Covers upstream state bugs and
 * feeds that silently freeze without sending an explicit close.
 */
const DEFAULT_CLOSED_AFTER_MS = 5 * 60_000

export class PriceStore {
  private prices = new Map<string, StoredPrice>()
  private listeners = new Set<(tick: PriceSnapshot) => void>()

  constructor(
    private readonly staleAfterMs = 30_000,
    private readonly closedAfterMs = DEFAULT_CLOSED_AFTER_MS,
  ) {}

  apply(tick: RawTick, now: number): PriceSnapshot | null {
    const bid = new Decimal(tick.bid)
    const ask = new Decimal(tick.ask)
    const mid = new Decimal(tick.mid)
    if (!bid.isFinite() || !ask.isFinite() || !mid.isFinite()) return null
    if (bid.lte(0) || ask.lte(0) || mid.lte(0)) return null
    if (bid.gt(ask)) return null

    const previous = this.prices.get(tick.symbol)
    const hasMetadata =
      tick.marketState !== undefined ||
      tick.stale !== undefined ||
      tick.quoteAgeSeconds !== undefined
    // A replayed/stale quote must not overwrite a newer price, but REST
    // metadata (marketState/stale/quoteAge) is always authoritative: it is the
    // only place biquote exposes the market state, and at the weekly close the
    // frozen snapshot timestamp can be older than the last streamed tick.
    const acceptPrice = !previous || tick.sourceTs >= previous.sourceTs
    if (!acceptPrice && !hasMetadata) return null

    const quoteAdvanced = acceptPrice && (!previous || tick.sourceTs > previous.sourceTs)
    const spread = ask.minus(bid).toNumber()
    const history = (previous?.history ?? []).filter((h) => now - h.at < SPREAD_WINDOW_MS)
    if (acceptPrice) history.push({ at: now, spread })

    // SignalR ticks carry no quoteAgeSeconds. Only a genuinely newer source
    // timestamp proves freshness; a replayed tick with the same timestamp must
    // keep the age growing instead of resetting it to zero.
    let ageAtUpdate: number
    let ageAnchorAt: number
    if (tick.quoteAgeSeconds !== undefined) {
      ageAtUpdate = Math.max(0, tick.quoteAgeSeconds) * 1000
      ageAnchorAt = now
    } else if (previous && !quoteAdvanced) {
      ageAtUpdate = previous.ageAtUpdate
      ageAnchorAt = previous.ageAnchorAt
    } else {
      ageAtUpdate = 0
      ageAnchorAt = now
    }

    const upstreamMarketState = tick.marketState ?? previous?.upstreamMarketState ?? 'open'
    const upstreamStale = tick.stale !== undefined ? tick.stale : (previous?.upstreamStale ?? null)

    const stored: StoredPrice = {
      symbol: tick.symbol,
      bid: acceptPrice ? tick.bid : previous!.bid,
      ask: acceptPrice ? tick.ask : previous!.ask,
      mid: acceptPrice ? tick.mid : previous!.mid,
      quoteToUsd: previous?.quoteToUsd ?? '1',
      marketState: 'open',
      stale: false,
      quoteAgeMs: 0,
      feedGapMs: 0,
      spreadSpike: false,
      sourceTs: acceptPrice ? tick.sourceTs : previous!.sourceTs,
      updatedAt: now,
      history,
      ageAtUpdate,
      ageAnchorAt,
      feedGapAtUpdate: previous ? Math.max(0, now - previous.updatedAt) : 0,
      feedGapAnchorAt: now,
      upstreamMarketState,
      upstreamStale,
    }
    const snapshot = this.snapshot(stored, now)
    Object.assign(stored, snapshot)
    this.prices.set(tick.symbol, stored)
    for (const listener of this.listeners) listener(snapshot)
    return snapshot
  }

  setQuoteToUsd(symbol: string, value: string): void {
    const p = this.prices.get(symbol)
    if (p) p.quoteToUsd = value
  }

  get(symbol: string, now = Date.now()): PriceSnapshot | null {
    const p = this.prices.get(symbol)
    return p ? this.snapshot(p, now) : null
  }

  all(): PriceSnapshot[] {
    const now = Date.now()
    return [...this.prices.keys()].map((s) => this.get(s, now)!).filter(Boolean)
  }

  lastTickAt(symbol: string): number | null {
    // Local receive time, not the upstream timestamp: biquote clocks can lag
    // tens of seconds even while ticks are flowing normally.
    return this.prices.get(symbol)?.updatedAt ?? null
  }

  onChange(listener: (tick: PriceSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Recompute age/staleness on read; called by the risk loop. */
  refreshAges(now: number): void {
    for (const p of this.prices.values()) {
      p.history = p.history.filter((h) => now - h.at < SPREAD_WINDOW_MS)
      Object.assign(p, this.snapshot(p, now))
    }
  }

  private snapshot(p: StoredPrice, now: number): PriceSnapshot {
    const trackedAgeMs = p.ageAtUpdate + Math.max(0, now - p.ageAnchorAt)
    // A replayed tick can carry a newer timestamp than the previous one while
    // still being hours old. Use the source timestamp as a lower bound once it
    // is beyond the closed threshold; small clock skew (tens of seconds) is
    // intentionally ignored.
    const sourceAgeMs = p.sourceTs > 0 ? Math.max(0, now - p.sourceTs) : 0
    const quoteAgeMs =
      sourceAgeMs > this.closedAfterMs ? Math.max(trackedAgeMs, sourceAgeMs) : trackedAgeMs
    const feedGapMs = p.feedGapAtUpdate + Math.max(0, now - p.feedGapAnchorAt)
    const stale = (p.upstreamStale ?? false) || quoteAgeMs > this.staleAfterMs
    // Upstream can keep reporting `open` while quotes have been frozen for
    // hours (observed on the production biquote instance during weekends).
    // Treat a long-frozen quote as closed so it cannot be opened against.
    const closed = p.upstreamMarketState === 'closed' || quoteAgeMs > this.closedAfterMs
    return {
      symbol: p.symbol,
      bid: p.bid,
      ask: p.ask,
      mid: p.mid,
      quoteToUsd: p.quoteToUsd,
      marketState: closed ? 'closed' : 'open',
      stale,
      quoteAgeMs,
      feedGapMs,
      spreadSpike: !stale && !closed && this.isSpreadSpike(p, now),
      sourceTs: p.sourceTs,
      updatedAt: p.updatedAt,
    }
  }

  private isSpreadSpike(p: StoredPrice, now: number): boolean {
    const history = p.history.filter((h) => now - h.at < SPREAD_WINDOW_MS)
    if (!history.length) return false
    const sorted = history.map((h) => h.spread).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? history[history.length - 1]!.spread
    const spread = new Decimal(p.ask).minus(new Decimal(p.bid)).toNumber()
    return median > 0 && spread > median * 3
  }
}
