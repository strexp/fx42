<script setup lang="ts">
import type { DailyPnlDto, FillDto } from '@fx42/contracts'

const { t } = useI18n()
const { api } = useApi()
const { money, date, pnlClass, actionLabel } = useFormat()

const tab = ref<'fills' | 'pnl'>('fills')
const fills = ref<FillDto[]>([])
const pnl = ref<DailyPnlDto[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const [f, p] = await Promise.all([
      api<{ items: FillDto[] }>('/api/history/fills?limit=100'),
      api<{ items: DailyPnlDto[] }>('/api/history/pnl?days=30'),
    ])
    fills.value = f.items
    pnl.value = p.items
  } finally {
    loading.value = false
  }
}
onMounted(load)

const maxAbs = computed(() => Math.max(1, ...pnl.value.map((p) => Math.abs(Number(p.net)))))
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">{{ t('history.title') }}</h1>
      <div class="border-default flex rounded-lg border p-0.5 text-xs">
        <button
          class="rounded-md px-3 py-1"
          :class="tab === 'fills' ? 'bg-accented' : 'text-muted'"
          @click="tab = 'fills'"
        >
          {{ t('history.fills') }}
        </button>
        <button
          class="rounded-md px-3 py-1"
          :class="tab === 'pnl' ? 'bg-accented' : 'text-muted'"
          @click="tab = 'pnl'"
        >
          {{ t('history.pnl') }}
        </button>
      </div>
    </div>

    <UCard
      v-if="tab === 'fills'"
      class="border-default bg-elevated"
      :ui="{ body: { padding: 'p-0 sm:p-0' } }"
    >
      <div v-if="!fills.length" class="text-dimmed py-12 text-center text-sm">
        {{ t('history.noFills') }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-sm">
          <thead class="border-default text-dimmed border-b text-left text-xs">
            <tr>
              <th class="px-4 py-3">{{ t('common.time') }}</th>
              <th class="px-4 py-3">{{ t('common.symbol') }}</th>
              <th class="px-4 py-3">{{ t('history.action') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.units') }}</th>
              <th class="px-4 py-3 text-right">{{ t('common.price') }}</th>
              <th class="px-4 py-3 text-right">{{ t('history.notional') }}</th>
              <th class="px-4 py-3 text-right">{{ t('history.fee') }}</th>
              <th class="px-4 py-3 text-right">{{ t('history.realized') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in fills" :key="String(f.id)" class="border-muted border-b last:border-0">
              <td class="text-muted px-4 py-2 text-xs">{{ date(f.createdAt as string) }}</td>
              <td class="px-4 py-2">{{ f.symbol }}</td>
              <td class="px-4 py-2 text-xs">
                {{ f.side === 'long' ? t('trade.long') : t('trade.short') }} ·
                {{ actionLabel(f.action) }}
              </td>
              <td class="tabular px-4 py-2 text-right">{{ f.units }}</td>
              <td class="tabular px-4 py-2 text-right">{{ f.price }}</td>
              <td class="tabular px-4 py-2 text-right">{{ money(f.notional as string) }}</td>
              <td class="tabular px-4 py-2 text-right">{{ money(f.fee as string) }}</td>
              <td class="tabular px-4 py-2 text-right" :class="pnlClass(f.realizedPnl as string)">
                {{ money(f.realizedPnl as string) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <UCard v-else class="border-default bg-elevated">
      <template #header
        ><h2 class="font-medium">{{ t('history.dailyPnl') }}</h2></template
      >
      <div v-if="!pnl.length" class="text-dimmed py-12 text-center text-sm">
        {{ t('history.noPnl') }}
      </div>
      <div v-else class="space-y-2">
        <div v-for="p in pnl" :key="p.date" class="flex items-center gap-3 text-sm">
          <span class="text-dimmed w-24 text-xs">{{ p.date }}</span>
          <div class="flex h-4 flex-1 items-center">
            <div
              class="h-2 rounded"
              :class="Number(p.net) >= 0 ? 'bg-emerald-500' : 'bg-rose-500'"
              :style="{ width: `${Math.max(2, (Math.abs(Number(p.net)) / maxAbs) * 100)}%` }"
            />
          </div>
          <span class="tabular w-28 text-right" :class="pnlClass(p.net)">{{ money(p.net) }}</span>
          <span class="tabular text-dimmed hidden w-24 text-right text-xs sm:block"
            >fin {{ money(p.financing) }}</span
          >
        </div>
      </div>
    </UCard>
  </div>
</template>
