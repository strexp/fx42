<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import type { FillDto, MarketTickerDto, StatsOverviewDto } from '@fx42/contracts'

const { t } = useI18n()
const { money, price, pnlClass, date, actionLabel, translateOr } = useFormat()
const { wallet, positions } = useAccountSnapshot()

function sideLabel(side: unknown): string {
  return translateOr('trade', side)
}

const { data: markets } = await useAsyncData('markets', () =>
  useRequestFetch()<MarketTickerDto[]>('/api/markets'),
)
const { data: stats } = await useAsyncData('stats', () =>
  useRequestFetch()<StatsOverviewDto>('/api/stats/overview'),
)
const fills = ref<FillDto[]>([])

async function loadFills() {
  try {
    const f = await $fetch<{ items: FillDto[] }>('/api/history/fills?limit=10')
    fills.value = f.items
  } catch {
    // layout handles auth
  }
}
onMounted(loadFills)
useIntervalFn(() => void loadFills(), 10_000, { immediate: false })

const { prices } = useMarketStream(
  computed(() => (markets.value ?? []).map((m) => m.symbol)),
  3000,
  { hidden: 'pause' },
)
const watchlist = computed(() =>
  (markets.value ?? [])
    .slice(0, 5)
    .map((market) => mergeTicker(market, prices.value[market.symbol])),
)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-xl font-semibold">{{ t('nav.dashboard') }}</h1>
        <p class="text-muted text-sm">{{ t('app.tagline') }}</p>
      </div>
      <UButton to="/markets" variant="soft" size="sm" icon="i-lucide-chart-candlestick">{{
        t('nav.markets')
      }}</UButton>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <UCard class="border-default bg-elevated">
        <div class="text-dimmed text-xs">{{ t('dashboard.equity') }}</div>
        <div
          class="mt-1 flex items-baseline gap-1 text-2xl font-semibold"
          data-testid="account-equity"
        >
          <AnimatedMoney :value="wallet?.equity" :digits="2" />
          <span class="text-dimmed text-sm">{{ wallet?.currency }}</span>
        </div>
      </UCard>
      <UCard class="border-default bg-elevated">
        <div class="text-dimmed text-xs">{{ t('dashboard.available') }}</div>
        <div class="mt-1 text-2xl font-semibold" data-testid="account-available">
          <AnimatedMoney :value="wallet?.available" :digits="2" />
        </div>
      </UCard>
      <UCard class="border-default bg-elevated">
        <div class="text-dimmed text-xs">{{ t('dashboard.marginUsed') }}</div>
        <div class="mt-1 text-2xl font-semibold" data-testid="account-margin-used">
          <AnimatedMoney :value="wallet?.marginUsed" :digits="2" />
        </div>
      </UCard>
      <UCard class="border-default bg-elevated">
        <div class="text-dimmed text-xs">{{ t('dashboard.unrealizedPnl') }}</div>
        <div
          class="mt-1 text-2xl font-semibold"
          :class="pnlClass(wallet?.unrealizedPnl)"
          data-testid="account-unrealized-pnl"
        >
          <AnimatedMoney :value="wallet?.unrealizedPnl" :digits="2" />
        </div>
      </UCard>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <UCard class="border-default bg-elevated">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-medium">{{ t('dashboard.positions') }}</h2>
            <UButton to="/positions" size="xs" variant="ghost">{{ t('common.more') }}</UButton>
          </div>
        </template>
        <div v-if="!positions.length" class="text-dimmed py-6 text-center text-sm">
          {{ t('dashboard.noPositions') }}
        </div>
        <div v-else class="space-y-2">
          <NuxtLink
            v-for="p in positions.slice(0, 5)"
            :key="p.id"
            :to="`/trade/${p.symbol}`"
            class="border-default hover:border-accented hover:bg-elevated flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition"
            data-testid="dashboard-position-row"
          >
            <div>
              <span class="font-medium">{{ p.symbol }}</span>
              <UBadge
                :color="p.side === 'long' ? 'success' : 'error'"
                size="xs"
                variant="subtle"
                class="ml-2"
              >
                {{ p.side === 'long' ? '▲' : '▼' }} {{ p.leverage }}x
              </UBadge>
            </div>
            <div class="flex items-center gap-2 text-right">
              <div>
                <div class="tabular" :class="pnlClass(p.unrealizedPnl)">
                  {{ money(p.unrealizedPnl) }}
                </div>
                <div class="text-dimmed text-[10px]">
                  {{ t('positions.liq') }} {{ price(p.liquidationPrice) }}
                </div>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
            </div>
          </NuxtLink>
        </div>
      </UCard>

      <UCard class="border-default bg-elevated">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-medium">{{ t('dashboard.watchlist') }}</h2>
            <UButton to="/markets" size="xs" variant="ghost">{{ t('common.more') }}</UButton>
          </div>
        </template>
        <div class="space-y-2">
          <NuxtLink
            v-for="m in watchlist"
            :key="m.symbol"
            :to="`/trade/${m.symbol}`"
            class="border-default hover:border-accented hover:bg-elevated flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition"
            data-testid="dashboard-market-row"
          >
            <div class="text-left">
              <div class="font-medium">{{ m.symbol }}</div>
              <div class="text-dimmed text-[10px]">{{ m.description }}</div>
            </div>
            <div class="flex items-center gap-2 text-right">
              <div>
                <div class="tabular">{{ m.mid }}</div>
                <div class="text-[10px]" :class="m.spreadSpike ? 'text-amber-300' : 'text-dimmed'">
                  {{
                    m.marketState === 'closed'
                      ? t('common.closed')
                      : m.stale
                        ? t('common.stale')
                        : t('common.open')
                  }}
                </div>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-dimmed size-4" />
            </div>
          </NuxtLink>
        </div>
      </UCard>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
      <UCard class="border-default bg-elevated">
        <template #header
          ><h2 class="font-medium">{{ t('dashboard.recentFills') }}</h2></template
        >
        <div v-if="!fills.length" class="text-dimmed py-6 text-center text-sm">
          {{ t('history.noFills') }}
        </div>
        <div
          v-for="f in fills"
          :key="String(f.id)"
          class="border-muted flex items-center justify-between border-b py-2 text-sm last:border-0"
        >
          <div>
            <span class="font-medium">{{ f.symbol }}</span>
            <span class="text-dimmed ml-2 text-xs"
              >{{ sideLabel(f.side) }} · {{ actionLabel(f.action) }}</span
            >
          </div>
          <div class="text-right">
            <div class="tabular" :class="pnlClass(f.realizedPnl as string)">
              {{ money(f.realizedPnl as string) }}
            </div>
            <div class="text-dimmed text-[10px]">{{ date(f.createdAt as string) }}</div>
          </div>
        </div>
      </UCard>
      <UCard class="border-default bg-elevated">
        <template #header
          ><h2 class="font-medium">{{ t('dashboard.window24h') }}</h2></template
        >
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div class="text-dimmed text-xs">{{ t('trade.notional') }}</div>
            <div class="tabular">{{ money(stats?.notional24h, 2) }}</div>
          </div>
          <div>
            <div class="text-dimmed text-xs">{{ t('dashboard.positions') }}</div>
            <div class="tabular">{{ stats?.openPositions ?? 0 }}</div>
          </div>
          <div>
            <div class="text-dimmed text-xs">{{ t('dashboard.liquidations') }}</div>
            <div class="tabular">{{ stats?.liquidations24h ?? 0 }}</div>
          </div>
          <div>
            <div class="text-dimmed text-xs">{{ t('dashboard.reserve') }}</div>
            <div>
              {{
                stats?.reserveCoverageOk === null
                  ? '—'
                  : stats?.reserveCoverageOk
                    ? t('dashboard.reserveOk')
                    : t('dashboard.reserveLow')
              }}
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
