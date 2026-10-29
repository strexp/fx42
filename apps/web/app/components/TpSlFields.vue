<script setup lang="ts">
const props = defineProps<{
  side: 'long' | 'short'
  referencePrice: string
  pipSize: string
  pricePrecision: number
  takeProfitLocked?: boolean
  stopLossLocked?: boolean
}>()

const takeProfit = defineModel<string>('takeProfit', { default: '' })
const stopLoss = defineModel<string>('stopLoss', { default: '' })
const { t } = useI18n()

const pips = [5, 10, 25, 50, 100]
const reference = computed(() => Number(props.referencePrice))
const hasReference = computed(() => Number.isFinite(reference.value) && reference.value > 0)
const pip = computed(() => {
  const value = Number(props.pipSize)
  return Number.isFinite(value) && value > 0 ? value : 10 ** -Math.max(0, props.pricePrecision)
})
const step = computed(() =>
  Number.isFinite(pip.value) && pip.value > 0
    ? String(pip.value)
    : String(10 ** -Math.max(0, props.pricePrecision)),
)

function formatPrice(value: number): string {
  return value.toFixed(Math.max(0, Math.min(12, props.pricePrecision)))
}

function parsePrice(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const takeProfitValue = computed(() => parsePrice(takeProfit.value))
const stopLossValue = computed(() => parsePrice(stopLoss.value))

const takeProfitError = computed(() => {
  if (takeProfit.value.trim() && takeProfitValue.value === null) return t('trade.priceInvalid')
  if (takeProfitValue.value === null || !hasReference.value) return ''
  if (takeProfitValue.value <= 0) return t('trade.priceInvalid')
  if (
    props.side === 'long'
      ? takeProfitValue.value <= reference.value
      : takeProfitValue.value >= reference.value
  ) {
    return t('trade.tpInvalid')
  }
  return ''
})

const stopLossError = computed(() => {
  if (stopLoss.value.trim() && stopLossValue.value === null) return t('trade.priceInvalid')
  if (stopLossValue.value === null || !hasReference.value) return ''
  if (stopLossValue.value <= 0) return t('trade.priceInvalid')
  if (
    props.side === 'long'
      ? stopLossValue.value >= reference.value
      : stopLossValue.value <= reference.value
  ) {
    return t('trade.slInvalid')
  }
  return ''
})

// Locked fields are not submitted with the order, so their current values must
// not block order validation even if the market has moved past them.
const valid = computed(
  () =>
    (props.takeProfitLocked || !takeProfitError.value) &&
    (props.stopLossLocked || !stopLossError.value),
)

const takeProfitRange = computed(() =>
  props.side === 'long'
    ? `> ${formatPrice(reference.value + pip.value)}`
    : `0 – ${formatPrice(Math.max(0, reference.value - pip.value))}`,
)
const stopLossRange = computed(() =>
  props.side === 'long'
    ? `0 – ${formatPrice(Math.max(0, reference.value - pip.value))}`
    : `> ${formatPrice(reference.value + pip.value)}`,
)

const takeProfitMin = computed(() =>
  props.side === 'long' && hasReference.value ? formatPrice(reference.value + pip.value) : '0',
)
const takeProfitMax = computed(() =>
  props.side === 'short' && hasReference.value
    ? formatPrice(Math.max(0, reference.value - pip.value))
    : undefined,
)
const stopLossMin = computed(() =>
  props.side === 'short' && hasReference.value ? formatPrice(reference.value + pip.value) : '0',
)
const stopLossMax = computed(() =>
  props.side === 'long' && hasReference.value
    ? formatPrice(Math.max(0, reference.value - pip.value))
    : undefined,
)

function setTakeProfit(distance: number): void {
  if (!hasReference.value) return
  const value =
    props.side === 'long'
      ? reference.value + distance * pip.value
      : reference.value - distance * pip.value
  if (Number.isFinite(value) && value > 0) takeProfit.value = formatPrice(value)
}

function setStopLoss(distance: number): void {
  if (!hasReference.value) return
  const value =
    props.side === 'long'
      ? reference.value - distance * pip.value
      : reference.value + distance * pip.value
  if (Number.isFinite(value) && value > 0) stopLoss.value = formatPrice(value)
}

defineExpose({ valid })
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-2" :class="takeProfitLocked ? 'opacity-60' : ''">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">{{ t('trade.takeProfit') }}</span>
        <UButton
          v-if="takeProfit && !takeProfitLocked"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="takeProfit = ''"
        >
          {{ t('trade.clear') }}
        </UButton>
      </div>
      <UInput
        :model-value="takeProfit"
        type="number"
        :min="takeProfitMin"
        :max="takeProfitMax"
        :step="step"
        placeholder="—"
        class="w-full"
        :disabled="takeProfitLocked"
        @update:model-value="takeProfit = String($event ?? '')"
      />
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-dimmed text-[10px]">{{ t('trade.quickSet') }}</span>
        <UButton
          v-for="distance in pips"
          :key="`tp-${distance}`"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="!hasReference || takeProfitLocked"
          @click="setTakeProfit(distance)"
        >
          {{ distance }} {{ t('trade.pips') }}
        </UButton>
      </div>
      <p class="text-dimmed text-[10px]">
        {{ t('trade.validRange', { range: takeProfitRange }) }}
      </p>
      <p v-if="takeProfitError && !takeProfitLocked" class="text-xs text-amber-300">
        {{ takeProfitError }}
      </p>
    </div>

    <div class="space-y-2" :class="stopLossLocked ? 'opacity-60' : ''">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium">{{ t('trade.stopLoss') }}</span>
        <UButton
          v-if="stopLoss && !stopLossLocked"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="stopLoss = ''"
        >
          {{ t('trade.clear') }}
        </UButton>
      </div>
      <UInput
        :model-value="stopLoss"
        type="number"
        :min="stopLossMin"
        :max="stopLossMax"
        :step="step"
        placeholder="—"
        class="w-full"
        :disabled="stopLossLocked"
        @update:model-value="stopLoss = String($event ?? '')"
      />
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-dimmed text-[10px]">{{ t('trade.quickSet') }}</span>
        <UButton
          v-for="distance in pips"
          :key="`sl-${distance}`"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="!hasReference || stopLossLocked"
          @click="setStopLoss(distance)"
        >
          {{ distance }} {{ t('trade.pips') }}
        </UButton>
      </div>
      <p class="text-dimmed text-[10px]">
        {{ t('trade.validRange', { range: stopLossRange }) }}
      </p>
      <p v-if="stopLossError && !stopLossLocked" class="text-xs text-amber-300">
        {{ stopLossError }}
      </p>
    </div>
  </div>
</template>
