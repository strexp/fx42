import { useDocumentVisibility, useEventSource } from '@vueuse/core'

export interface StreamPrice {
  symbol: string
  bid: string
  ask: string
  mid: string
  marketState: 'open' | 'closed'
  stale: boolean
  quoteAgeMs: number
  spreadSpike: boolean
  sourceTs: number
}

export interface MarketStreamOptions {
  hidden?: 'pause' | 'slow'
  hiddenRefreshMs?: number
}

interface MarketPayload {
  type: string
  data: StreamPrice[]
  feed: { connected: boolean; lastTickAt: number | null }
}

function parsePayload(value?: string): MarketPayload | null {
  if (!value) return null
  try {
    return JSON.parse(value) as MarketPayload
  } catch {
    return null
  }
}

export function useMarketStream(
  symbols: Ref<string[]>,
  refreshMs = 250,
  options: MarketStreamOptions = {},
) {
  const prices = useState<Record<string, StreamPrice>>('fx42-prices', () => ({}))
  const connected = useState<boolean>('fx42-stream-connected', () => false)
  const feed = useState<{ connected: boolean; lastTickAt: number | null }>('fx42-feed', () => ({
    connected: false,
    lastTickAt: null,
  }))
  const visibility = useDocumentVisibility()
  const active = ref(false)

  const streamInterval = computed(() => {
    if (!active.value) return 0
    if (visibility.value === 'visible') return refreshMs
    return (options.hidden ?? 'pause') === 'pause' ? 0 : (options.hiddenRefreshMs ?? 5_000)
  })

  const streamUrl = computed(() => {
    if (streamInterval.value === 0) return undefined
    const params = new URLSearchParams()
    if (symbols.value.length) params.set('symbols', symbols.value.join(','))
    if (streamInterval.value !== 250) params.set('interval', String(streamInterval.value))
    const query = params.toString() ? `?${params}` : ''
    return `/api/stream/market${query}`
  })

  const { data, status } = useEventSource(streamUrl, undefined, {
    immediate: false,
    serializer: { read: parsePayload },
  })

  watch(
    status,
    (next) => {
      connected.value = next === 'OPEN'
    },
    { immediate: true },
  )

  watch(data, (payload) => {
    if (!payload || payload.type !== 'prices') return
    const next = { ...prices.value }
    for (const price of payload.data) next[price.symbol] = price
    prices.value = next
    feed.value = payload.feed
  })

  function connect() {
    active.value = true
  }

  function disconnect() {
    active.value = false
    connected.value = false
  }

  onMounted(connect)
  onBeforeUnmount(disconnect)

  return { prices, connected, feed, connect, disconnect }
}
