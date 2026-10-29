import Decimal from 'decimal.js'
import { candlesQuerySchema } from '@fx42/contracts'
import { AppError, INTERVAL_MS, type CandleInterval } from '@fx42/shared'
import { instrumentDirection, normalizeUsdBaseCandle, isUsdBaseInstrument } from '@fx42/domain'
import { apiHandler, parseQuery } from '../../../../utils/api'
import { requireUser } from '../../../../utils/auth'
import { ctx, runtime } from '../../../../utils/runtime'
import { ftkPrice } from '../../../../utils/market'

const STALE_MS: Record<CandleInterval, number> = {
  '1m': 30_000,
  '5m': 60_000,
  '15m': 120_000,
  '30m': 180_000,
  '1h': 5 * 60_000,
  '4h': 15 * 60_000,
  '1d': 30 * 60_000,
}

const inFlightCandleFetches = new Map<string, Promise<void>>()

export default apiHandler(async (event) => {
  await requireUser(event)
  const symbol = getRouterParam(event, 'symbol') ?? ''
  const query = parseQuery(event, candlesQuerySchema)
  const inst = ctx().config.instruments.find((i) => i.symbol === symbol && i.enabled)
  if (!inst) throw new AppError('SYMBOL_DISABLED')
  let rows = ctx().repos.market.listCandles(symbol, query.interval, query.limit)
  const latest = ctx().repos.market.latestCandleTime(symbol, query.interval)
  if (
    runtime().env.FX42_MODE === 'production' &&
    (!latest || Date.now() - latest > (STALE_MS[query.interval] ?? 60_000)) &&
    rows.length < query.limit
  ) {
    const key = `${symbol}:${query.interval}:${query.limit}`
    let task = inFlightCandleFetches.get(key)
    if (!task) {
      task = (async () => {
        const fetched = await runtime().biquote.ohlc(symbol, query.interval, query.limit)
        for (const c of fetched) {
          const normalized = isUsdBaseInstrument(inst)
            ? normalizeUsdBaseCandle(c, inst.pricePrecision)
            : { open: c.open, high: c.high, low: c.low, close: c.close }
          ctx().repos.market.upsertCandle({
            symbol,
            interval: query.interval,
            openTime: c.openTime,
            ...normalized,
            tickVolume: c.volume,
            isOpen: c.isOpen,
            now: Date.now(),
          })
        }
      })()
        .catch(() => {
          // serve cached data if biquote is unavailable
        })
        .finally(() => inFlightCandleFetches.delete(key))
      inFlightCandleFetches.set(key, task)
    }
    await task
    rows = ctx().repos.market.listCandles(symbol, query.interval, query.limit)
  }
  const price = ctx().prices.get(symbol)
  // Merge the live quote into the current bucket so the newest candle agrees
  // with the ticker even when the upstream OHLC endpoint lags by one bar.
  const step = INTERVAL_MS[query.interval] ?? 60_000
  const bucketStart = Math.floor(Date.now() / step) * step
  if (price && price.marketState === 'open') {
    const mid = new Decimal(price.mid)
    const last = rows[rows.length - 1]
    if (!last) {
      rows = [
        {
          symbol,
          interval: query.interval,
          openTime: bucketStart,
          open: mid.toFixed(inst.pricePrecision),
          high: mid.toFixed(inst.pricePrecision),
          low: mid.toFixed(inst.pricePrecision),
          close: mid.toFixed(inst.pricePrecision),
          tickVolume: 0,
          isOpen: true,
          fetchedAt: Date.now(),
        },
      ]
    } else if (last.openTime < bucketStart) {
      const open = new Decimal(last.close)
      rows = [
        ...rows,
        {
          symbol,
          interval: query.interval,
          openTime: bucketStart,
          open: open.toFixed(inst.pricePrecision),
          high: Decimal.max(open, mid).toFixed(inst.pricePrecision),
          low: Decimal.min(open, mid).toFixed(inst.pricePrecision),
          close: mid.toFixed(inst.pricePrecision),
          tickVolume: 0,
          isOpen: true,
          fetchedAt: Date.now(),
        },
      ]
    } else if (last.openTime === bucketStart) {
      const high = Decimal.max(new Decimal(last.high), mid)
      const low = Decimal.min(new Decimal(last.low), mid)
      last.high = high.toFixed(inst.pricePrecision)
      last.low = low.toFixed(inst.pricePrecision)
      last.close = mid.toFixed(inst.pricePrecision)
      last.isOpen = true
    }
  }
  const display = (value: string) => ftkPrice(ctx(), value).toFixed(inst.pricePrecision)
  const bars = rows.map((c) => ({
    t: Math.floor(c.openTime / 1000),
    o: display(c.open),
    h: display(c.high),
    l: display(c.low),
    c: display(c.close),
    v: c.tickVolume,
    isOpen: c.isOpen,
  }))
  const closed = rows.filter((r) => !r.isOpen)
  const mas: Record<string, Array<{ t: number; v: string | null }>> = {}
  for (const period of ctx().config.chart.mas) {
    const values: Array<{ t: number; v: string | null }> = []
    const closes = closed.map((r) => new Decimal(r.close))
    let sum = new Decimal(0)
    for (let i = 0; i < closed.length; i++) {
      sum = sum.plus(closes[i]!)
      if (i >= period) sum = sum.minus(closes[i - period]!)
      values.push({
        t: Math.floor(closed[i]!.openTime / 1000),
        v: i >= period - 1 ? display(sum.div(period).toString()) : null,
      })
    }
    mas[`sma${period}`] = values
  }
  return {
    symbol,
    interval: query.interval,
    quoteCurrency: instrumentDirection(inst)?.quote ?? inst.symbol.slice(3, 6),
    priceUnit: 'FTK',
    bars,
    mas,
  }
})
