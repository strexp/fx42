import { newId } from '@fx42/shared'
import { mapCandle, n, nn } from '../database'
import type { CandleRow } from '../types'
import { RepoBase } from './base'

export class MarketRepos extends RepoBase {
  upsertPrice(input: {
    symbol: string
    bid: string
    ask: string
    mid: string
    quoteToUsd: string
    marketState: 'open' | 'closed'
    stale: boolean
    quoteAgeMs: number
    sourceTs: number
    now: number
  }): void {
    this.sql
      .prepare(
        `INSERT INTO market_prices
          (symbol, bid, ask, mid, quote_to_usd, market_state, stale, quote_age_ms, source_ts, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET bid = excluded.bid, ask = excluded.ask, mid = excluded.mid,
           quote_to_usd = excluded.quote_to_usd, market_state = excluded.market_state, stale = excluded.stale,
           quote_age_ms = excluded.quote_age_ms, source_ts = excluded.source_ts, updated_at = excluded.updated_at`,
      )
      .run(
        input.symbol,
        input.bid,
        input.ask,
        input.mid,
        input.quoteToUsd,
        input.marketState,
        input.stale ? 1 : 0,
        BigInt(input.quoteAgeMs),
        BigInt(input.sourceTs),
        BigInt(input.now),
      )
  }

  upsertCandle(candle: {
    symbol: string
    interval: string
    openTime: number
    open: string
    high: string
    low: string
    close: string
    tickVolume: number | null
    isOpen: boolean
    now: number
  }): void {
    this.sql
      .prepare(
        `INSERT INTO candles
          (symbol, interval, open_time, open, high, low, close, tick_volume, is_open, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, interval, open_time) DO UPDATE SET open = excluded.open, high = excluded.high,
           low = excluded.low, close = excluded.close, tick_volume = excluded.tick_volume,
           is_open = excluded.is_open, fetched_at = excluded.fetched_at`,
      )
      .run(
        candle.symbol,
        candle.interval,
        BigInt(candle.openTime),
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.tickVolume === null ? null : BigInt(candle.tickVolume),
        candle.isOpen ? 1 : 0,
        BigInt(candle.now),
      )
  }

  listCandles(symbol: string, interval: string, limit: number): CandleRow[] {
    const rows = this.sql
      .prepare(
        'SELECT * FROM candles WHERE symbol = ? AND interval = ? ORDER BY open_time DESC LIMIT ?',
      )
      .all(symbol, interval, BigInt(limit)) as Record<string, unknown>[]
    return rows.map(mapCandle).reverse()
  }

  latestCandleTime(symbol: string, interval: string): number | null {
    const row = this.sql
      .prepare('SELECT max(open_time) AS t FROM candles WHERE symbol = ? AND interval = ?')
      .get(symbol, interval) as { t: bigint | null }
    return nn(row.t)
  }

  setFeedStatus(
    connected: boolean,
    lastTickAt: number | null,
    reconnects: number,
    now: number,
  ): void {
    this.sql
      .prepare(
        'UPDATE feed_status SET connected = ?, last_tick_at = ?, reconnects = ?, updated_at = ? WHERE id = 1',
      )
      .run(
        connected ? 1 : 0,
        lastTickAt === null ? null : BigInt(lastTickAt),
        BigInt(reconnects),
        BigInt(now),
      )
  }

  getFeedStatus(): { connected: boolean; lastTickAt: number | null; reconnects: number } {
    const row = this.sql.prepare('SELECT * FROM feed_status WHERE id = 1').get() as Record<
      string,
      unknown
    >
    return {
      connected: n(row.connected) === 1,
      lastTickAt: nn(row.last_tick_at),
      reconnects: n(row.reconnects),
    }
  }

  addReconciliationReport(kind: string, ok: boolean, details: unknown, now: number): void {
    this.sql
      .prepare(
        'INSERT INTO reconciliation_reports (id, kind, ok, details, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        newId(),
        kind,
        ok ? 1 : 0,
        details === null ? null : JSON.stringify(details),
        BigInt(now),
      )
  }

  countUsers(): number {
    const row = this.sql.prepare('SELECT count(*) AS c FROM users').get() as { c: bigint }
    return n(row.c)
  }

  countOpenPositionsAll(): number {
    const row = this.sql
      .prepare("SELECT count(*) AS c FROM positions WHERE status = 'open'")
      .get() as { c: bigint }
    return n(row.c)
  }

  countLiquidationsSince(since: number): number {
    const row = this.sql
      .prepare('SELECT count(*) AS c FROM liquidations WHERE created_at >= ?')
      .get(BigInt(since)) as { c: bigint }
    return n(row.c)
  }

  sumNotionalSince(since: number): bigint {
    const row = this.sql
      .prepare('SELECT COALESCE(sum(notional_micros),0) AS s FROM fills WHERE created_at >= ?')
      .get(BigInt(since)) as { s: bigint }
    return BigInt(row.s)
  }
}
