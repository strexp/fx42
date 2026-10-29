<script setup lang="ts">
import { watchDebounced } from '@vueuse/core'
import type { MarketTickerDto, PositionDto, PreviewDto } from '@fx42/contracts'

const props = defineProps<{
  symbol: string
  ticker: MarketTickerDto
  position?: PositionDto | null
}>()
const emit = defineEmits<{ success: [payload: unknown] }>()
const { t } = useI18n()
const toast = useToast()
const { api } = useApi()
const { mode } = useAccountMode()
const trading = useTrading(toRef(props, 'symbol'))

const side = ref<'long' | 'short'>('long')
const leverage = ref(100)
const lots = ref('0.01')
const unitMode = ref<'lots' | 'units'>('lots')
const units = ref(String(Number(props.ticker.contractSize) * 0.01))
const takeProfit = ref('')
const stopLoss = ref('')
const preview = ref<PreviewDto | null>(null)
const showConfirm = ref(false)
const submitting = ref(false)
const tpSlRef = ref<{ valid: boolean } | null>(null)

const hasPosition = computed(() => !!props.position)
const positionLeverage = computed(() => props.position?.leverage ?? leverage.value)
const stopLossLocked = computed(() => hasPosition.value)
const fallbackAction = computed(() => {
  if (!props.position) return 'open'
  return props.position.side === side.value ? 'increase' : 'reduce'
})
const previewAction = computed(() => preview.value?.action ?? fallbackAction.value)
const isClosing = computed(
  () => previewAction.value === 'reduce' || previewAction.value === 'close',
)
// When the order only closes/reduces the existing position, TP is meaningless
// (and would be validated against the opposite side), so lock it as well.
const takeProfitLocked = computed(() => isClosing.value)
const actionLabel = computed(() => {
  if (previewAction.value === 'open') return t('trade.submit')
  return t(`trade.${previewAction.value}`)
})
const sideLabel = computed(() => (side.value === 'long' ? t('trade.long') : t('trade.short')))
const marginLabel = computed(() => {
  if (isClosing.value) return t('trade.marginReleased')
  if (previewAction.value === 'flip') return t('trade.newMargin')
  return t('trade.margin')
})
const realizedPnlClass = computed(() =>
  Number(preview.value?.realizedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
)

watch(
  () => props.position?.id,
  (id) => {
    if (!id) {
      stopLoss.value = ''
      return
    }
    leverage.value = props.position!.leverage
    side.value = props.position!.side
    stopLoss.value = props.position!.stopLoss ?? ''
  },
  { immediate: true },
)

// Keep the locked leverage/SL in sync if the position is updated elsewhere
// (for example after adding margin or changing TP/SL from the position panel).
watch(
  () => positionLeverage.value,
  (value) => {
    if (hasPosition.value) leverage.value = value
  },
)
watch(
  () => props.position?.stopLoss,
  (value) => {
    if (hasPosition.value) stopLoss.value = value ?? ''
  },
)

const tpSlReference = computed(() => (side.value === 'long' ? props.ticker.ask : props.ticker.bid))
const tpSlValid = computed(() => tpSlRef.value?.valid ?? true)

const leverageItems = computed(() =>
  props.ticker.leverageTiers.map((l) => ({ label: `${l}x`, value: l })),
)

let previewSequence = 0

async function refreshPreview() {
  const sequence = ++previewSequence
  const body: Record<string, unknown> = {
    mode: mode.value,
    symbol: props.symbol,
    side: side.value,
    leverage: positionLeverage.value,
  }
  if (unitMode.value === 'lots') body.lots = lots.value
  else body.units = units.value
  try {
    const result = await api<PreviewDto>('/api/orders/preview', { method: 'POST', body })
    if (sequence === previewSequence) preview.value = result
  } catch {
    if (sequence === previewSequence) preview.value = null
  }
}

watchDebounced(
  [
    side,
    leverage,
    lots,
    units,
    unitMode,
    () =>
      `${props.position?.id ?? ''}:${props.position?.units ?? ''}:${props.position?.margin ?? ''}:${props.position?.entryPrice ?? ''}`,
  ],
  refreshPreview,
  { debounce: 250 },
)
onMounted(refreshPreview)

const canOpen = computed(() => {
  if (!props.ticker || props.ticker.spreadSpike) return false
  if (props.ticker.marketState === 'closed' || props.ticker.stale) return false
  return true
})

async function confirmSubmit() {
  submitting.value = true
  try {
    const input: Parameters<typeof trading.placeOrder>[0] = {
      side: side.value,
      leverage: positionLeverage.value,
      ...(unitMode.value === 'lots' ? { lots: lots.value } : { units: units.value }),
      takeProfit: takeProfitLocked.value ? undefined : takeProfit.value || undefined,
      stopLoss: stopLossLocked.value ? undefined : stopLoss.value || undefined,
    }
    const result = await trading.placeOrder(input)
    showConfirm.value = false
    toast.add({ title: t('trade.submit'), color: 'success' })
    emit('success', result)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UCard class="border-default bg-elevated">
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="font-medium">{{ t('trade.orderTicket') }}</h2>
        <UBadge
          :color="
            ticker.marketState === 'closed' ? 'neutral' : ticker.stale ? 'warning' : 'success'
          "
          size="sm"
          variant="subtle"
        >
          {{
            ticker.marketState === 'closed'
              ? t('trade.closedBanner')
              : ticker.stale
                ? t('common.stale')
                : t('common.open')
          }}
        </UBadge>
      </div>
    </template>

    <div class="grid grid-cols-2 gap-3">
      <button
        class="rounded-xl border-2 px-3 py-3 text-left transition"
        :class="
          side === 'long'
            ? 'border-emerald-500 bg-emerald-500/10'
            : 'border-default hover:border-accented'
        "
        @click="side = 'long'"
      >
        <div class="flex items-center gap-1 font-semibold text-emerald-400">
          ▲ {{ t('trade.long') }}
        </div>
        <div class="tabular text-muted mt-1 text-xs">{{ ticker.ask }}</div>
      </button>
      <button
        class="rounded-xl border-2 px-3 py-3 text-left transition"
        :class="
          side === 'short'
            ? 'border-rose-500 bg-rose-500/10'
            : 'border-default hover:border-accented'
        "
        @click="side = 'short'"
      >
        <div class="flex items-center gap-1 font-semibold text-rose-400">
          ▼ {{ t('trade.short') }}
        </div>
        <div class="tabular text-muted mt-1 text-xs">{{ ticker.bid }}</div>
      </button>
    </div>

    <div
      class="mt-3 text-center text-xs"
      :class="ticker.spreadSpike ? 'text-amber-300' : 'text-muted'"
    >
      {{ t('trade.spread') }}: <span class="tabular">{{ ticker.spreadPips }}</span>
      {{ t('trade.pips') }}
      <span v-if="ticker.spreadSpike"> · {{ t('trade.spreadSpike') }}</span>
    </div>

    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <UFormField :label="t('trade.leverage')">
        <USelect
          v-model="leverage"
          :items="leverageItems"
          value-key="value"
          class="w-full"
          :disabled="hasPosition"
        />
      </UFormField>
      <UFormField :label="t('trade.effectiveMaxLots')">
        <div class="tabular text-toned flex h-9 items-center text-sm">
          {{ preview?.effectiveMaxLots ?? '—' }}
        </div>
      </UFormField>
    </div>

    <p v-if="hasPosition" class="text-dimmed mt-2 text-[10px]">
      {{ t('trade.lockedHint') }}
    </p>

    <div class="mt-3">
      <div class="border-default mb-1 flex rounded-lg border p-0.5 text-xs">
        <button
          class="flex-1 rounded-md py-1"
          :class="unitMode === 'lots' ? 'bg-accented' : 'text-muted'"
          @click="unitMode = 'lots'"
        >
          {{ t('trade.lots') }}
        </button>
        <button
          class="flex-1 rounded-md py-1"
          :class="unitMode === 'units' ? 'bg-accented' : 'text-muted'"
          @click="unitMode = 'units'"
        >
          {{ t('trade.units') }}
        </button>
      </div>
      <UInput
        v-if="unitMode === 'lots'"
        :model-value="lots"
        type="number"
        :min="ticker.minLots"
        :step="ticker.lotStep"
        class="w-full"
        size="lg"
        @update:model-value="lots = String($event ?? '')"
      />
      <UInput
        v-else
        :model-value="units"
        type="number"
        min="1"
        step="1"
        class="w-full"
        size="lg"
        @update:model-value="units = String($event ?? '')"
      />
    </div>

    <div class="mt-3">
      <TpSlFields
        ref="tpSlRef"
        v-model:take-profit="takeProfit"
        v-model:stop-loss="stopLoss"
        :side="side"
        :reference-price="tpSlReference"
        :pip-size="ticker.pipSize"
        :price-precision="ticker.pricePrecision"
        :take-profit-locked="takeProfitLocked"
        :stop-loss-locked="stopLossLocked"
      />
    </div>

    <div class="bg-muted mt-4 space-y-1.5 rounded-lg p-3 text-xs">
      <div class="flex justify-between">
        <span class="text-muted">{{ t('trade.fillPrice') }}</span
        ><span class="tabular">{{ preview?.fillPrice ?? '—' }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-muted">{{ t('trade.notional') }}</span
        ><span class="tabular">{{ preview?.notionalFtk ?? '—' }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-muted">{{ marginLabel }}</span
        ><span class="tabular">{{ preview?.margin ?? '—' }}</span>
      </div>
      <div v-if="preview && Number(preview.openFee) > 0" class="flex justify-between">
        <span class="text-muted">{{ t('trade.openFee') }}</span
        ><span class="tabular">{{ preview.openFee }}</span>
      </div>
      <div v-if="preview && Number(preview.closeFee) > 0" class="flex justify-between">
        <span class="text-muted">{{ t('trade.closeFee') }}</span
        ><span class="tabular">{{ preview.closeFee }}</span>
      </div>
      <div
        v-if="preview?.realizedPnl !== null && preview?.realizedPnl !== undefined"
        class="flex justify-between"
      >
        <span class="text-muted">{{ t('trade.estimatedPnl') }}</span
        ><span class="tabular" :class="realizedPnlClass">{{ preview.realizedPnl }}</span>
      </div>
      <div v-if="preview?.liquidationPrice" class="flex justify-between">
        <span class="text-muted">{{ t('trade.liquidationPrice') }}</span
        ><span class="tabular text-rose-300">{{ preview.liquidationPrice }}</span>
      </div>
      <div
        v-if="previewAction !== 'reduce' && previewAction !== 'close'"
        class="flex justify-between"
      >
        <span class="text-muted">{{ t('trade.maxLoss') }}</span
        ><span class="tabular">{{ preview?.maxLoss ?? '—' }}</span>
      </div>
      <div
        v-if="preview && preview.action !== 'open'"
        class="border-default mt-2 space-y-1.5 border-t pt-2"
      >
        <div class="text-dimmed mb-1 text-[10px]">{{ t('trade.positionAfter') }}</div>
        <div class="flex justify-between">
          <span class="text-muted">{{ t('trade.units') }}</span
          ><span class="tabular">{{ preview.resultingUnits }}</span>
        </div>
        <div v-if="preview.resultingEntryPrice" class="flex justify-between">
          <span class="text-muted">{{ t('trade.avgEntry') }}</span
          ><span class="tabular">{{ preview.resultingEntryPrice }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted">{{ t('trade.margin') }}</span
          ><span class="tabular">{{ preview.resultingMargin }}</span>
        </div>
      </div>
      <div class="border-default text-dimmed mt-2 border-t pt-2 text-[10px]">
        {{ t('trade.ftkRate', { rate: ticker.ftkUsdRate }) }}
      </div>
    </div>

    <UButton
      class="mt-4"
      block
      size="lg"
      :color="side === 'long' ? 'success' : 'error'"
      :disabled="!canOpen || !tpSlValid"
      @click="showConfirm = true"
    >
      {{ previewAction === 'open' ? `${sideLabel} · ${actionLabel}` : actionLabel }}
    </UButton>
    <p v-if="!canOpen" class="mt-2 text-xs text-amber-300">
      {{
        ticker.spreadSpike
          ? t('trade.spreadSpike')
          : ticker.marketState === 'closed'
            ? t('trade.closedBanner')
            : t('common.stale')
      }}
    </p>

    <UModal v-model:open="showConfirm" :title="t('trade.confirmTitle')">
      <template #body>
        <p class="text-toned text-sm">{{ t('trade.confirmText') }}</p>
        <div class="mt-3 space-y-1 text-sm">
          <div class="flex justify-between">
            <span class="text-muted">{{ t('trade.leverage') }}</span
            ><span>{{ leverage }}x</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted">{{ marginLabel }}</span
            ><span class="tabular">{{ preview?.margin }}</span>
          </div>
          <div
            v-if="preview?.realizedPnl !== null && preview?.realizedPnl !== undefined"
            class="flex justify-between"
          >
            <span class="text-muted">{{ t('trade.estimatedPnl') }}</span
            ><span class="tabular" :class="realizedPnlClass">{{ preview.realizedPnl }}</span>
          </div>
          <div v-if="preview?.liquidationPrice" class="flex justify-between">
            <span class="text-muted">{{ t('trade.liquidationPrice') }}</span
            ><span class="tabular text-rose-300">{{ preview.liquidationPrice }}</span>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showConfirm = false">{{
            t('common.cancel')
          }}</UButton>
          <UButton :loading="submitting" @click="confirmSubmit">{{ t('common.confirm') }}</UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
