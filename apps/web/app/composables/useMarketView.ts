import type { MarketTickerDto } from '@fx42/contracts'

export function spreadPips(bid: string, ask: string, pipSize: string): string {
  const pip = Number(pipSize)
  if (!(pip > 0)) return '—'
  return ((Number(ask) - Number(bid)) / pip).toFixed(1)
}

export function mergeTicker(
  base: MarketTickerDto,
  live:
    | {
        bid: string
        ask: string
        mid: string
        marketState: 'open' | 'closed'
        stale: boolean
        spreadSpike: boolean
      }
    | undefined,
): MarketTickerDto {
  if (!live) return base
  return {
    ...base,
    bid: live.bid,
    ask: live.ask,
    mid: live.mid,
    marketState: live.marketState,
    stale: live.stale,
    spreadSpike: live.spreadSpike,
    spreadPips: spreadPips(live.bid, live.ask, base.pipSize),
  }
}

export function useMarketTicker(symbol: Ref<string>, base: Ref<MarketTickerDto | null>) {
  const { prices } = useMarketStream(
    computed(() => [symbol.value]),
    250,
    {
      hidden: 'slow',
      hiddenRefreshMs: 5000,
    },
  )
  const ticker = computed(() =>
    base.value ? mergeTicker(base.value, prices.value[symbol.value]) : null,
  )
  return { ticker, prices }
}
