import Decimal from 'decimal.js'
import type { Fx42Config } from '@fx42/config'
import type { DbRepos } from '@fx42/db'
import type { PriceStore } from './price-store'
import { isWeekendWindow } from '@fx42/application'
import { CANDLE_INTERVALS, INTERVAL_MS } from '@fx42/shared'
import {
  instrumentDirection,
  normalizeUsdBaseCandle,
  normalizeUsdBasePrice,
  isUsdBaseInstrument,
  quoteToUsdAt,
} from '@fx42/domain'

const BASE: Record<string, { price: string; pip: string; vol: number }> = {
  EURUSD: { price: '1.11500', pip: '0.0001', vol: 0.00008 },
  GBPUSD: { price: '1.27200', pip: '0.0001', vol: 0.0001 },
  USDJPY: { price: '157.000', pip: '0.01', vol: 0.012 },
  AUDUSD: { price: '0.66200', pip: '0.0001', vol: 0.00006 },
  NZDUSD: { price: '0.56320', pip: '0.0001', vol: 0.00005 },
  USDCAD: { price: '1.39690', pip: '0.0001', vol: 0.00008 },
  USDCHF: { price: '0.82600', pip: '0.0001', vol: 0.00006 },
  USDCNH: { price: '6.65600', pip: '0.0001', vol: 0.0004 },
  USDSGD: { price: '1.28000', pip: '0.0001', vol: 0.00008 },
  XAUUSD: { price: '2400.00', pip: '0.01', vol: 0.6 },
}

export class MockFeed {
  private timer: NodeJS.Timeout | null = null
  private seeded = false
  private state = new Map<string, number>()

  constructor(
    private readonly config: Fx42Config,
    private readonly store: PriceStore,
    private readonly repos: DbRepos,
  ) {
    for (const [symbol, base] of Object.entries(BASE)) this.state.set(symbol, Number(base.price))
  }

  start(): void {
    this.tick()
    this.timer = setInterval(() => this.tick(), 500)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    const now = Date.now()
    const weekend = isWeekendWindow(this.config, now)
    for (const inst of this.config.instruments.filter((i) => i.enabled)) {
      const base = BASE[inst.symbol] ?? { price: '1.0000', pip: inst.pipSize, vol: 0.0001 }
      let value = this.state.get(inst.symbol) ?? Number(base.price)
      const shock = (Math.random() - 0.5) * 2 * base.vol
      value = Math.max(Number(base.pip) * 10, value + shock)
      this.state.set(inst.symbol, value)
      const pip = Number(base.pip)
      const halfSpread = pip * 0.3
      const rawBid = value - halfSpread
      const rawAsk = value + halfSpread
      const rawMid = value
      const needsInversion = isUsdBaseInstrument(inst)
      const bid = needsInversion
        ? normalizeUsdBasePrice(rawAsk, inst.pricePrecision)
        : rawBid.toFixed(inst.pricePrecision)
      const ask = needsInversion
        ? normalizeUsdBasePrice(rawBid, inst.pricePrecision)
        : rawAsk.toFixed(inst.pricePrecision)
      const mid = needsInversion
        ? normalizeUsdBasePrice(rawMid, inst.pricePrecision)
        : rawMid.toFixed(inst.pricePrecision)
      this.store.apply(
        {
          symbol: inst.symbol,
          bid,
          ask,
          mid,
          marketState: weekend ? 'closed' : 'open',
          stale: false,
          quoteAgeSeconds: 0,
          sourceTs: now,
        },
        now,
      )
      const direction = instrumentDirection(inst)!
      this.store.setQuoteToUsd(
        inst.symbol,
        quoteToUsdAt({ ...inst, ...direction }, new Decimal(needsInversion ? mid : value)).toFixed(
          12,
        ),
      )
    }
    this.repos.market.setFeedStatus(true, now, 0, now)
    if (!this.seeded) {
      this.seeded = true
      this.seedCandles(now)
    }
  }

  private seedCandles(now: number): void {
    const intervals = CANDLE_INTERVALS
    this.repos.transaction(() => {
      for (const inst of this.config.instruments.filter((i) => i.enabled)) {
        const base = BASE[inst.symbol] ?? { price: '1.0000', pip: inst.pipSize, vol: 0.0001 }
        const current = this.state.get(inst.symbol) ?? Number(base.price)
        for (const interval of intervals) {
          if (this.repos.market.latestCandleTime(inst.symbol, interval) !== null) continue
          const step = INTERVAL_MS[interval]!
          const limit = 300
          // Scale volatility by the square root of the bar duration so a daily
          // candle is not as flat as a 1-minute candle.
          const barVol = base.vol * Math.sqrt(step / 60_000)
          const closes: number[] = []
          let price = current * (1 + (Math.random() - 0.5) * 0.002)
          for (let i = 0; i < limit; i++) {
            price = Math.max(Number(base.pip) * 10, price + (Math.random() - 0.5) * 2 * barVol)
            closes.push(price)
          }
          // Anchor the synthetic path to the live price so the newest candle and
          // the historical series are visually continuous.
          const scale = current / closes[closes.length - 1]!
          const bucketStart = Math.floor(now / step) * step
          for (let i = 0; i < limit; i++) {
            const close = closes[i]! * scale
            const open = i === 0 ? close : closes[i - 1]! * scale
            const high = Math.max(open, close) + Math.random() * barVol * 0.6
            const low = Math.max(
              Number(base.pip) * 5,
              Math.min(open, close) - Math.random() * barVol * 0.6,
            )
            const normalized = isUsdBaseInstrument(inst)
              ? normalizeUsdBaseCandle(
                  {
                    open: open.toString(),
                    high: high.toString(),
                    low: low.toString(),
                    close: close.toString(),
                  },
                  inst.pricePrecision,
                )
              : {
                  open: open.toFixed(inst.pricePrecision),
                  high: high.toFixed(inst.pricePrecision),
                  low: low.toFixed(inst.pricePrecision),
                  close: close.toFixed(inst.pricePrecision),
                }
            this.repos.market.upsertCandle({
              symbol: inst.symbol,
              interval,
              openTime: bucketStart - (limit - 1 - i) * step,
              ...normalized,
              tickVolume: Math.floor(Math.random() * 1000) + 10,
              isOpen: i === limit - 1,
              now,
            })
          }
        }
      }
    })
  }
}
