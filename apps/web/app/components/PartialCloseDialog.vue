<script setup lang="ts">
import type { MarketTickerDto, PositionDto } from '@fx42/contracts'

const props = defineProps<{
  position: PositionDto | null
  ticker?: MarketTickerDto | null
  stale?: boolean
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const { busy: submitting, closeOne } = usePositionActions()
const toast = useToast()
const { money, number, pnlClass } = useFormat()

const amount = ref('')
const confirmStale = ref(false)

const totalUnits = computed(() => (props.position ? Number(props.position.units) : 0))
const contractSize = computed(() => (props.position ? Number(props.position.contractSize) : 1))
const stepUnits = computed(() => {
  if (!props.position) return 1
  const step = Number(props.position.contractSize) * Number(props.position.lotStep)
  return Number.isFinite(step) && step > 0 ? step : 1
})
const minRemainingUnits = computed(() => {
  if (!props.position) return 0
  const min = Number(props.position.contractSize) * Number(props.position.minLots)
  return Number.isFinite(min) && min > 0 ? min : 0
})
const maxPartialUnits = computed(() => Math.max(0, totalUnits.value - minRemainingUnits.value))
const amountValue = computed(() => Number(amount.value))
const fullClose = computed(
  () =>
    totalUnits.value > 0 &&
    amountValue.value > 0 &&
    Math.abs(amountValue.value - totalUnits.value) < 1e-9,
)
const remainingUnits = computed(() => Math.max(0, totalUnits.value - amountValue.value))
const closedLots = computed(() =>
  contractSize.value > 0 ? amountValue.value / contractSize.value : 0,
)
const remainingLots = computed(() =>
  contractSize.value > 0 ? remainingUnits.value / contractSize.value : 0,
)

const closePrice = computed(() => {
  if (!props.ticker || !props.position) return null
  return Number(props.position.side === 'long' ? props.ticker.bid : props.ticker.ask)
})
const estimatedFee = computed(() => {
  if (!props.ticker || closePrice.value === null || amountValue.value <= 0) return null
  return (amountValue.value * closePrice.value * props.ticker.takerBps) / 10_000
})
const estimatedPnl = computed(() => {
  if (!props.position || closePrice.value === null || amountValue.value <= 0) return null
  const diff =
    props.position.side === 'long'
      ? closePrice.value - Number(props.position.entryPrice)
      : Number(props.position.entryPrice) - closePrice.value
  return diff * amountValue.value
})

const validationMessage = computed(() => {
  if (!props.position) return t('trade.closeAmountRequired')
  if (!Number.isFinite(amountValue.value) || amountValue.value <= 0) {
    return t('trade.closeAmountRequired')
  }
  if (amountValue.value > totalUnits.value + 1e-9) {
    return t('trade.closeAmountExceeds', { max: formatUnits(totalUnits.value) })
  }
  return ''
})

const canSubmit = computed(() => !submitting.value && !validationMessage.value)

function formatUnits(value: number): string {
  return String(Number(value.toFixed(8)))
}

function setAmount(value: number): void {
  amount.value = value > 0 ? formatUnits(value) : ''
}

function setPercent(percent: number): void {
  const raw = (totalUnits.value * percent) / 100
  const aligned =
    stepUnits.value > 0
      ? Math.floor((raw + 1e-9) / stepUnits.value) * stepUnits.value
      : Math.floor(raw)
  setAmount(Math.min(aligned, maxPartialUnits.value))
}

function setFull(): void {
  setAmount(totalUnits.value)
}

function reset(): void {
  amount.value = ''
  confirmStale.value = false
}

watch(open, (value) => {
  if (value) reset()
})
watch(
  () => props.position?.id,
  () => {
    if (open.value) reset()
  },
)

async function submit(): Promise<void> {
  if (!props.position || !canSubmit.value) return
  await closeOne(props.position.id, confirmStale.value, fullClose.value ? undefined : amount.value)
  toast.add({
    title: fullClose.value
      ? t('positions.closed')
      : t('trade.partialCloseDone', { remaining: formatUnits(remainingUnits.value) }),
    color: 'success',
  })
  open.value = false
  emit('changed')
}
</script>

<template>
  <UModal v-model:open="open" :title="t('trade.closePositionTitle')">
    <template #body>
      <div v-if="position" class="space-y-4">
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div class="text-dimmed text-xs">{{ t('positions.units') }}</div>
            <div class="tabular">{{ formatUnits(totalUnits) }}</div>
            <div class="text-dimmed text-[10px]">
              {{ number(totalUnits / contractSize, 4) }} {{ t('trade.lots') }}
            </div>
          </div>
          <div>
            <div class="text-dimmed text-xs">{{ t('trade.remaining') }}</div>
            <div class="tabular">{{ formatUnits(remainingUnits) }}</div>
            <div class="text-dimmed text-[10px]">
              {{ number(remainingLots, 4) }} {{ t('trade.lots') }}
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="percent in [25, 50, 75]"
            :key="percent"
            size="xs"
            color="neutral"
            variant="soft"
            :disabled="maxPartialUnits <= 0"
            @click="setPercent(percent)"
          >
            {{ percent }}%
          </UButton>
          <UButton size="xs" color="warning" variant="soft" @click="setFull">
            {{ t('trade.closeAllUnits') }}
          </UButton>
        </div>

        <UFormField :label="t('trade.closeAmount')">
          <UInput
            :model-value="amount"
            type="number"
            min="0"
            :max="totalUnits"
            :step="stepUnits"
            placeholder="—"
            @update:model-value="amount = String($event ?? '')"
          />
        </UFormField>
        <p v-if="validationMessage" class="text-xs text-amber-300">{{ validationMessage }}</p>

        <div class="bg-muted space-y-1.5 rounded-lg p-3 text-xs">
          <div class="flex justify-between">
            <span class="text-muted">{{ t('trade.closeLots') }}</span>
            <span class="tabular">{{ number(closedLots, 4) }}</span>
          </div>
          <div v-if="estimatedFee !== null" class="flex justify-between">
            <span class="text-muted">{{ t('trade.estimatedFee') }}</span>
            <span class="tabular">{{ money(estimatedFee, 4) }} FTK</span>
          </div>
          <div v-if="estimatedPnl !== null" class="flex justify-between">
            <span class="text-muted">{{ t('trade.estimatedPnl') }}</span>
            <span class="tabular" :class="pnlClass(estimatedPnl)">
              {{ money(estimatedPnl, 4) }} FTK
            </span>
          </div>
          <div
            v-if="position.takeProfit || position.stopLoss"
            class="text-dimmed border-default border-t pt-2"
          >
            {{ t('trade.tpSlPreserved') }}
          </div>
        </div>

        <UAlert v-if="stale" color="warning" variant="subtle" :title="t('trade.staleWarning')" />
        <UCheckbox v-if="stale" v-model="confirmStale" :label="t('trade.confirmStale')" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="open = false">
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          :color="fullClose ? 'warning' : 'primary'"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ t('common.confirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
