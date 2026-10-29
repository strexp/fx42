import type { OrderDto } from '@fx42/contracts'

export function useTrading(symbol: Ref<string>) {
  const { api } = useApi()
  const { mode } = useAccountMode()
  const { refresh: refreshAccount } = useAccountSnapshot()
  const loading = ref(false)

  async function placeOrder(input: {
    side: 'long' | 'short'
    lots?: string
    units?: string
    leverage: number
    takeProfit?: string
    stopLoss?: string
    confirmStale?: boolean
  }) {
    loading.value = true
    try {
      const data = await api<{ order: OrderDto }>('/api/orders', {
        method: 'POST',
        body: {
          mode: mode.value,
          symbol: symbol.value,
          side: input.side,
          lots: input.lots,
          units: input.units,
          leverage: input.leverage,
          type: 'market',
          clientOrderId: `web-${crypto.randomUUID()}`,
          takeProfit: input.takeProfit || undefined,
          stopLoss: input.stopLoss || undefined,
          confirmStale: input.confirmStale ?? false,
        },
      })
      await refreshAccount()
      return data
    } finally {
      loading.value = false
    }
  }

  return { loading, placeOrder }
}
