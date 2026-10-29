<script setup lang="ts">
import type { MarketTickerDto } from '@fx42/contracts'

const { t } = useI18n()
const { data } = await useAsyncData('markets', () =>
  useRequestFetch()<MarketTickerDto[]>('/api/markets'),
)
const { prices } = useMarketStream(
  computed(() => (data.value ?? []).map((m) => m.symbol)),
  3000,
  { hidden: 'pause' },
)
const search = ref('')

const rows = computed(() => {
  const list = (data.value ?? []).map((market) => mergeTicker(market, prices.value[market.symbol]))
  return list.filter((m) => m.symbol.toLowerCase().includes(search.value.toLowerCase()))
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">{{ t('markets.title') }}</h1>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        :placeholder="t('markets.searchPlaceholder')"
        class="w-56"
        size="sm"
      />
    </div>
    <MarketClock />
    <UCard class="border-default bg-elevated" :ui="{ body: { padding: 'p-0 sm:p-0' } }">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-sm">
          <thead class="border-default text-dimmed border-b text-left text-xs">
            <tr>
              <th class="px-4 py-3">{{ t('markets.symbol') }}</th>
              <th class="px-4 py-3 text-right">{{ t('markets.last') }}</th>
              <th class="px-4 py-3 text-right">{{ t('markets.bid') }}</th>
              <th class="px-4 py-3 text-right">{{ t('markets.ask') }}</th>
              <th class="px-4 py-3 text-right">{{ t('markets.spread') }}</th>
              <th class="px-4 py-3 text-right">{{ t('markets.state') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.symbol"
              class="border-muted hover:bg-elevated cursor-pointer border-b"
              :class="row.marketState === 'closed' ? 'opacity-60' : ''"
              @click="navigateTo(`/trade/${row.symbol}`)"
            >
              <td class="px-4 py-3">
                <div class="font-medium">{{ row.symbol }}</div>
                <div class="text-dimmed text-xs">{{ row.description }}</div>
              </td>
              <td class="tabular px-4 py-3 text-right text-base">{{ row.mid }}</td>
              <td class="tabular px-4 py-3 text-right text-emerald-300">{{ row.bid }}</td>
              <td class="tabular px-4 py-3 text-right text-rose-300">{{ row.ask }}</td>
              <td
                class="tabular px-4 py-3 text-right"
                :class="row.spreadSpike ? 'text-amber-300' : ''"
              >
                {{ row.spreadPips }}
              </td>
              <td class="px-4 py-3 text-right">
                <UBadge
                  v-if="row.marketState === 'closed'"
                  color="neutral"
                  size="sm"
                  variant="subtle"
                  >{{ t('common.closed') }}</UBadge
                >
                <UBadge v-else-if="row.spreadSpike" color="warning" size="sm" variant="subtle">{{
                  t('trade.spreadSpike')
                }}</UBadge>
                <UBadge v-else-if="row.stale" color="warning" size="sm" variant="subtle">{{
                  t('common.stale')
                }}</UBadge>
                <UBadge v-else color="success" size="sm" variant="subtle">{{
                  t('common.open')
                }}</UBadge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
