import { requireUser } from '../../../utils/auth'
import { ctx } from '../../../utils/runtime'
import { streamSse } from '../../../utils/sse'
import { ftkPriceForSymbol } from '../../../utils/market'

export default defineEventHandler(async (event) => {
  try {
    await requireUser(event)
  } catch {
    setResponseStatus(event, 401)
    return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }
  }
  const query = getQuery(event)
  const requested =
    typeof query.symbols === 'string' ? query.symbols.split(',').filter(Boolean) : []
  const symbols = requested.length
    ? requested
    : ctx()
        .config.instruments.filter((i) => i.enabled)
        .map((i) => i.symbol)
  const refreshMs = Math.min(10_000, Math.max(250, Number(query.interval ?? 250) || 250))

  return streamSse(event, {
    intervalMs: refreshMs,
    send: (sse) => {
      const data = symbols
        .map((symbol) => ctx().prices.get(symbol))
        .filter((price): price is NonNullable<typeof price> => !!price)
        .map((price) => ({
          symbol: price.symbol,
          bid: ftkPriceForSymbol(ctx(), price.symbol, price.bid),
          ask: ftkPriceForSymbol(ctx(), price.symbol, price.ask),
          mid: ftkPriceForSymbol(ctx(), price.symbol, price.mid),
          marketState: price.marketState,
          stale: price.stale,
          quoteAgeMs: price.quoteAgeMs,
          spreadSpike: price.spreadSpike,
          sourceTs: price.sourceTs,
        }))
      sse.send(null, { type: 'prices', data, feed: ctx().repos.market.getFeedStatus() })
    },
  })
})
