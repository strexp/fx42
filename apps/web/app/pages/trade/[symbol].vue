<script setup lang="ts">
import { CANDLE_INTERVALS } from '@fx42/shared'
import type { MarketTickerDto } from '@fx42/contracts'

const route = useRoute()
const { t } = useI18n()
const { mode } = useAccountMode()
const symbol = computed(() => String(route.params.symbol ?? 'EURUSD').toUpperCase())
const interval = ref('1h')

const { data: markets } = await useAsyncData('markets', () =>
  useRequestFetch()<MarketTickerDto[]>('/api/markets'),
)
const { data: tickerData } = await useAsyncData(
  () => `ticker:${symbol.value}`,
  () => useRequestFetch()<MarketTickerDto>(`/api/markets/${symbol.value}/ticker`),
  { watch: [symbol] },
)

const symbols = computed(() => (markets.value ?? []).map((m) => m.symbol))
const { ticker } = useMarketTicker(symbol, tickerData)

const { positions, wallet, positionFor, refresh: refreshAccount } = useAccountSnapshot()
const currentPosition = computed(() => positionFor(symbol.value))

if (markets.value?.length && !symbols.value.includes(symbol.value)) {
  await navigateTo(`/trade/${symbols.value[0]}`, { replace: true })
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-for="s in symbols"
        :key="s"
        :to="`/trade/${s}`"
        size="sm"
        :color="s === symbol ? 'primary' : 'neutral'"
        :variant="s === symbol ? 'solid' : 'ghost'"
      >
        {{ s }}
      </UButton>
      <div class="ml-auto flex items-center gap-2">
        <USelect v-model="interval" :items="CANDLE_INTERVALS" size="sm" class="w-24" />
      </div>
    </div>

    <div v-if="ticker" class="grid gap-2 text-sm sm:grid-cols-4">
      <div class="border-default bg-elevated rounded-lg border px-3 py-2">
        <div class="text-dimmed text-xs">{{ t('markets.last') }}</div>
        <div class="tabular text-lg font-semibold">{{ ticker.mid }}</div>
      </div>
      <div class="border-default bg-elevated rounded-lg border px-3 py-2">
        <div class="text-dimmed text-xs">{{ t('markets.bid') }} / {{ t('markets.ask') }}</div>
        <div class="tabular">{{ ticker.bid }} / {{ ticker.ask }}</div>
      </div>
      <div class="border-default bg-elevated rounded-lg border px-3 py-2">
        <div class="text-dimmed text-xs">{{ t('markets.spread') }}</div>
        <div class="tabular" :class="ticker.spreadSpike ? 'text-amber-300' : ''">
          {{ ticker.spreadPips }} pips
        </div>
      </div>
      <div class="border-default bg-elevated rounded-lg border px-3 py-2">
        <div class="text-dimmed text-xs">{{ t('common.mode') }}</div>
        <UBadge :color="mode === 'real' ? 'success' : 'warning'" variant="subtle" size="sm">{{
          t(`common.${mode}`)
        }}</UBadge>
      </div>
    </div>

    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div class="space-y-4">
        <UCard class="border-default bg-elevated" :ui="{ body: { padding: 'p-2 sm:p-3' } }">
          <ClientOnly>
            <PriceChart
              v-if="ticker"
              :symbol="symbol"
              :interval="interval"
              :price-precision="ticker.pricePrecision"
              :market-state="ticker.marketState"
              :price="ticker.mid"
              :position="currentPosition"
            />
            <template #fallback>
              <div class="text-dimmed grid h-[420px] place-items-center text-sm">
                {{ t('common.loading') }}
              </div>
            </template>
          </ClientOnly>
        </UCard>
        <PositionPanel
          v-if="ticker"
          :symbol="symbol"
          :positions="positions"
          :wallet="wallet"
          :ticker="ticker"
          @changed="refreshAccount"
        />
      </div>
      <div class="space-y-4">
        <OrderTicket
          v-if="ticker"
          :symbol="symbol"
          :ticker="ticker"
          :position="currentPosition"
          @success="refreshAccount"
        />
        <MarketClock />
      </div>
    </div>
  </div>
</template>
