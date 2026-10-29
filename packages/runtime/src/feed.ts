import Decimal from 'decimal.js'
import {
  HubConnectionBuilder,
  HubConnection,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr'
import type { Fx42Config } from '@fx42/config'
import type { DbRepos } from '@fx42/db'
import type { InstrumentConfig } from '@fx42/domain'
import {
  instrumentDirection,
  normalizeUsdBasePrice,
  isUsdBaseInstrument,
  quoteToUsdAt,
} from '@fx42/domain'
import type { BiquoteClient } from '@fx42/clients'
import type { PriceStore, RawTick } from './price-store'
import { MockFeed } from './mock-feed'

function parseTick(raw: Record<string, unknown>): RawTick | null {
  const symbol = raw.symbol ?? raw.Symbol
  if (typeof symbol !== 'string') return null
  const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)
  const bid = str(raw.bid ?? raw.Bid)
  const ask = str(raw.ask ?? raw.Ask)
  const mid = str(raw.mid ?? raw.Mid)
  if (!bid || !ask || !mid) return null
  const tsRaw = raw.timestamp ?? raw.sourceTs ?? raw.time
  const sourceTs =
    typeof tsRaw === 'number'
      ? tsRaw < 1e12
        ? tsRaw * 1000
        : tsRaw
      : typeof tsRaw === 'string'
        ? Number.isFinite(Date.parse(tsRaw))
          ? Date.parse(tsRaw)
          : Date.now()
        : Date.now()
  const age = Number(raw.quoteAgeSeconds ?? raw.quote_age_seconds)
  const stateRaw = raw.marketState ?? raw.market_state
  return {
    symbol: symbol.toUpperCase(),
    bid,
    ask,
    mid,
    // The SignalR tick payload has no marketState/stale fields. Leave them
    // undefined so PriceStore keeps the authoritative REST metadata instead of
    // flipping the market between open and closed on every tick.
    ...(stateRaw === 'open' || stateRaw === 'closed' ? { marketState: stateRaw } : {}),
    ...(typeof raw.stale === 'boolean' ? { stale: raw.stale } : {}),
    ...(Number.isFinite(age) ? { quoteAgeSeconds: age } : {}),
    sourceTs,
  }
}

export class FeedRuntime {
  private mock: MockFeed | null = null
  private connection: HubConnection | null = null
  private watchdog: NodeJS.Timeout | null = null
  private snapshotTimer: NodeJS.Timeout | null = null
  private restTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private lastPersisted = new Map<string, number>()
  private lastRejectLog = new Map<string, number>()
  private lastWatchdogRestart = 0
  private lastRestErrorAt = 0
  private lastMetaPollAt = 0
  private pollingRest = false
  private connecting = false
  private stopped = false
  private instruments: InstrumentConfig[]

  constructor(
    private readonly config: Fx42Config,
    private readonly store: PriceStore,
    private readonly repos: DbRepos,
    private readonly mode: 'production' | 'mock',
    private readonly hubUrl: string,
    private readonly biquote: BiquoteClient,
    private readonly log: {
      warn: (o: unknown, m?: string) => void
      info: (o: unknown, m?: string) => void
    },
  ) {
    this.instruments = config.instruments
      .filter((i) => i.enabled)
      .map((i) => ({ ...i, ...instrumentDirection(i)! }))
  }

  async start(): Promise<void> {
    this.store.onChange((tick) => this.onTick(tick.symbol))
    this.snapshotTimer = setInterval(() => this.persistSnapshots(), 1000)
    if (this.mode === 'mock') {
      this.mock = new MockFeed(this.config, this.store, this.repos)
      this.mock.start()
      return
    }
    await this.connect()
    this.watchdog = setInterval(() => this.checkSilence(), 1000)
    this.restTimer = setInterval(() => void this.pollRest(), 5000)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.watchdog) clearInterval(this.watchdog)
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    if (this.restTimer) clearInterval(this.restTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.mock?.stop()
    if (this.connection) {
      try {
        await this.connection.stop()
      } catch {
        // ignore
      }
      this.connection = null
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return
    if (this.connection?.state === HubConnectionState.Connected) return
    this.connecting = true
    try {
      if (this.connection) {
        try {
          await this.connection.stop()
        } catch {
          // ignore old connection shutdown errors
        }
      }
      const connection = new HubConnectionBuilder()
        .withUrl(this.hubUrl)
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.Warning)
        .build()
      this.connection = connection
      connection.on('ReceiveTick', (raw: Record<string, unknown>) => {
        const tick = parseTick(raw)
        if (tick) this.applyTick(tick)
      })
      connection.onreconnecting((error) => {
        this.repos.market.setFeedStatus(false, null, 0, Date.now())
        this.log.warn({ error: error?.message }, 'signalr reconnecting')
      })
      connection.onreconnected(async () => {
        this.log.info({}, 'signalr reconnected')
        await this.resubscribe()
      })
      connection.onclose((error) => {
        this.repos.market.setFeedStatus(false, null, 0, Date.now())
        if (this.stopped) return
        this.log.warn({ error: error?.message }, 'signalr closed; reconnecting')
        this.scheduleReconnect(3000)
      })
      try {
        await connection.start()
        await this.resubscribe()
        this.repos.market.setFeedStatus(true, Date.now(), 0, Date.now())
        this.log.info({ symbols: this.instruments.length }, 'signalr connected')
      } catch (error) {
        this.log.warn({ error: (error as Error).message }, 'signalr connect failed')
        this.repos.market.setFeedStatus(false, null, 0, Date.now())
        this.scheduleReconnect(5000)
      }
    } finally {
      this.connecting = false
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delayMs)
  }

  private async resubscribe(): Promise<void> {
    if (!this.connection) return
    const symbols = this.instruments.map((i) => i.symbol)
    try {
      await this.connection.invoke('Subscribe', symbols)
    } catch {
      for (const symbol of symbols) {
        try {
          await this.connection.invoke('Subscribe', symbol)
        } catch {
          this.log.warn({ symbol }, 'failed to subscribe symbol')
        }
      }
    }
  }

  private applyTick(rawTick: RawTick): void {
    const instrument = this.instruments.find((i) => i.symbol === rawTick.symbol)
    if (!instrument) return
    const tick = isUsdBaseInstrument(instrument)
      ? {
          ...rawTick,
          bid: normalizeUsdBasePrice(rawTick.ask, instrument.pricePrecision),
          ask: normalizeUsdBasePrice(rawTick.bid, instrument.pricePrecision),
          mid: normalizeUsdBasePrice(rawTick.mid, instrument.pricePrecision),
        }
      : rawTick
    try {
      const now = Date.now()
      const before = this.store.get(tick.symbol, now)
      const snapshot = this.store.apply(tick, now)
      if (!snapshot) {
        const last = this.lastRejectLog.get(tick.symbol) ?? 0
        if (now - last > 60_000) {
          this.lastRejectLog.set(tick.symbol, now)
          this.log.warn(
            { symbol: tick.symbol, sourceTs: tick.sourceTs, bid: tick.bid, ask: tick.ask },
            'tick rejected',
          )
        }
        return
      }
      // Use the accepted snapshot rather than the incoming tick: an
      // out-of-order replay may update metadata only and leave the price alone.
      const q2u = quoteToUsdAt(instrument, new Decimal(snapshot.mid)).toFixed(12)
      this.store.setQuoteToUsd(tick.symbol, q2u)
      this.repos.market.setFeedStatus(true, now, 0, now)
      // Quotes resumed after a long freeze (e.g. weekly open): refresh the
      // authoritative marketState right away instead of waiting for the
      // metadata poll, otherwise the symbol stays "closed" for up to 30s.
      if (
        before &&
        before.quoteAgeMs > 5 * 60_000 &&
        snapshot.quoteAgeMs < 30_000 &&
        now - this.lastMetaPollAt > 5_000
      ) {
        void this.pollRest()
      }
    } catch (error) {
      this.log.warn({ symbol: tick.symbol, error: (error as Error).message }, 'rejected tick')
    }
  }

  private onTick(symbol: string): void {
    const now = Date.now()
    const last = this.lastPersisted.get(symbol) ?? 0
    if (now - last < 1000) return
    this.lastPersisted.set(symbol, now)
    const p = this.store.get(symbol)
    if (!p) return
    this.repos.market.upsertPrice({
      symbol,
      bid: p.bid,
      ask: p.ask,
      mid: p.mid,
      quoteToUsd: p.quoteToUsd,
      marketState: p.marketState,
      stale: p.stale,
      quoteAgeMs: p.quoteAgeMs,
      sourceTs: p.sourceTs,
      now,
    })
  }

  private persistSnapshots(): void {
    for (const { symbol } of this.instruments) this.onTick(symbol)
  }

  private checkSilence(): void {
    if (this.connection?.state !== HubConnectionState.Connected) return
    const now = Date.now()
    if (now - this.lastWatchdogRestart < 30_000) return
    for (const instrument of this.instruments) {
      const last = this.store.lastTickAt(instrument.symbol)
      if (!last) continue
      const p = this.store.get(instrument.symbol)
      if (!p || p.marketState === 'closed') continue
      const idle = now - last
      if (idle > 15_000) {
        this.lastWatchdogRestart = now
        this.log.warn({ symbol: instrument.symbol, idle }, 'tick silent; restarting connection')
        void this.connection.stop()
        break
      }
    }
  }

  /**
   * Fallback when SignalR is blocked or half-open: pull a batch of latest
   * quotes over REST. This is one request per 5s, far below the public limit.
   */
  private async pollRest(): Promise<void> {
    if (this.stopped || this.pollingRest) return
    const now = Date.now()
    const connected = this.connection?.state === HubConnectionState.Connected
    const anyStale = this.instruments.some((inst) => {
      const last = this.store.lastTickAt(inst.symbol)
      return !last || now - last > 10_000
    })
    // SignalR ticks do not carry marketState/stale; refresh authoritative
    // metadata over REST even while the stream is healthy. Keep this short so
    // a freeze/close is reflected quickly, independent of stream liveness.
    const needsMeta = now - this.lastMetaPollAt > 30_000
    if (connected && !anyStale && !needsMeta) return
    this.pollingRest = true
    try {
      const ticks = await this.biquote.latest(this.instruments.map((i) => i.symbol))
      this.lastMetaPollAt = now
      for (const tick of ticks) {
        if (!this.instruments.some((i) => i.symbol === tick.symbol)) continue
        this.applyTick({
          symbol: tick.symbol,
          bid: tick.bid,
          ask: tick.ask,
          mid: tick.mid,
          marketState: tick.marketState,
          stale: tick.stale,
          quoteAgeSeconds: tick.quoteAgeSeconds,
          sourceTs: tick.sourceTs || now,
        })
      }
    } catch (error) {
      if (now - this.lastRestErrorAt > 60_000) {
        this.lastRestErrorAt = now
        this.log.warn({ error: (error as Error).message }, 'REST quote fallback failed')
      }
    } finally {
      this.pollingRest = false
    }
  }
}
