<script setup lang="ts">
import type { PositionDto } from '@fx42/contracts'

const { t } = useI18n()
const { money, price, pnlClass } = useFormat()
const toast = useToast()
const { positions, wallet, refresh: refreshAccount } = useAccountSnapshot()
const { closeAll: closeAllPositions, closeOne: closeOnePosition } = usePositionActions()
const loading = ref(false)
const showCloseAll = ref(false)
const allowStale = ref(false)
const closeTarget = ref<PositionDto | null>(null)
const showCloseOne = ref(false)
const partialTarget = ref<PositionDto | null>(null)
const showPartial = ref(false)
const closing = ref(false)

async function refresh() {
  loading.value = true
  try {
    await refreshAccount()
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

async function closeAll() {
  await closeAllPositions(allowStale.value)
  showCloseAll.value = false
}

function requestClose(p: PositionDto) {
  closeTarget.value = p
  showCloseOne.value = true
}

function requestPartial(p: PositionDto) {
  partialTarget.value = p
  showPartial.value = true
}

async function closeOne() {
  if (!closeTarget.value) return
  closing.value = true
  try {
    await closeOnePosition(closeTarget.value.id, true)
    showCloseOne.value = false
    toast.add({ title: t('positions.closed'), color: 'success' })
  } finally {
    closing.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-xl font-semibold">{{ t('positions.title') }}</h1>
        <p class="text-muted text-sm">
          {{ t('positions.pnl') }}:
          <span class="inline-flex items-baseline gap-1" :class="pnlClass(wallet?.unrealizedPnl)">
            <AnimatedMoney :value="wallet?.unrealizedPnl" :digits="4" />
            <span>{{ wallet?.currency }}</span>
          </span>
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          variant="soft"
          color="neutral"
          size="sm"
          :loading="loading"
          icon="i-lucide-refresh-cw"
          @click="refresh"
          >{{ t('common.refresh') }}</UButton
        >
        <UButton
          v-if="positions.length"
          color="warning"
          variant="soft"
          size="sm"
          @click="showCloseAll = true"
          >{{ t('positions.closeAll') }}</UButton
        >
      </div>
    </div>

    <UCard class="border-default bg-elevated" :ui="{ body: { padding: 'p-0 sm:p-0' } }">
      <div v-if="!positions.length" class="text-dimmed py-12 text-center text-sm">
        {{ t('positions.noPositions') }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[900px] text-sm">
          <thead class="border-default text-dimmed border-b text-left text-xs">
            <tr>
              <th class="px-4 py-3">{{ t('positions.side') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.units') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.entry') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.mark') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.margin') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.pnl') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.liq') }}</th>
              <th class="px-4 py-3 text-right">{{ t('positions.ratio') }}</th>
              <th class="px-4 py-3 text-right">{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in positions" :key="p.id" class="border-muted border-b last:border-0">
              <td class="px-4 py-3">
                <div class="font-medium">{{ p.symbol }}</div>
                <UBadge :color="p.side === 'long' ? 'success' : 'error'" size="xs" variant="subtle">
                  {{ p.side === 'long' ? '▲ ' + t('trade.long') : '▼ ' + t('trade.short') }} ·
                  {{ p.leverage }}x
                </UBadge>
              </td>
              <td class="tabular px-4 py-3 text-right">{{ p.units }}</td>
              <td class="tabular px-4 py-3 text-right">{{ price(p.entryPrice) }}</td>
              <td class="tabular px-4 py-3 text-right">{{ price(p.markPrice) }}</td>
              <td class="tabular px-4 py-3 text-right">{{ money(p.margin) }}</td>
              <td class="tabular px-4 py-3 text-right" :class="pnlClass(p.unrealizedPnl)">
                {{ money(p.unrealizedPnl) }}
              </td>
              <td class="tabular px-4 py-3 text-right text-rose-300">
                {{ price(p.liquidationPrice) }}
              </td>
              <td class="tabular px-4 py-3 text-right">{{ p.marginRatio }}</td>
              <td class="px-4 py-3 text-right">
                <div class="flex justify-end gap-1">
                  <UButton :to="`/trade/${p.symbol}`" size="xs" variant="ghost">{{
                    t('nav.trade')
                  }}</UButton>
                  <UButton size="xs" color="neutral" variant="ghost" @click="requestPartial(p)">{{
                    t('trade.partialClose')
                  }}</UButton>
                  <UButton size="xs" color="error" variant="ghost" @click="requestClose(p)">{{
                    t('trade.close')
                  }}</UButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <PartialCloseDialog v-model:open="showPartial" :position="partialTarget" @changed="refresh" />

    <ConfirmDialog
      v-model:open="showCloseOne"
      :title="t('positions.confirmCloseTitle')"
      :description="
        t('positions.confirmClose', {
          symbol: closeTarget?.symbol ?? '',
          units: closeTarget?.units ?? '',
        })
      "
      color="error"
      :loading="closing"
      @confirm="closeOne"
    />

    <UModal v-model:open="showCloseAll" :title="t('positions.closeAll')">
      <template #body>
        <p class="text-toned text-sm">{{ t('trade.confirmText') }}</p>
        <UCheckbox v-model="allowStale" class="mt-3" :label="t('positions.includeStale')" />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showCloseAll = false">{{
            t('common.cancel')
          }}</UButton>
          <UButton color="warning" @click="closeAll">{{ t('common.confirm') }}</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
