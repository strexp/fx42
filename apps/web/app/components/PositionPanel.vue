<script setup lang="ts">
import { AUTO_CLOSE_SAFETY_RATIO, RISK_RATIO_THRESHOLDS } from '@fx42/domain'
import type { MarketTickerDto, PositionDto, WalletDto } from '@fx42/contracts'

const marginCallRatio = Number(RISK_RATIO_THRESHOLDS.marginCall)
const dangerRatio = Number(RISK_RATIO_THRESHOLDS.danger)
const warningRatio = Number(RISK_RATIO_THRESHOLDS.warning)
const autoCloseSafety = Number(AUTO_CLOSE_SAFETY_RATIO)

const props = defineProps<{
  symbol: string
  positions: PositionDto[]
  wallet: WalletDto | null
  ticker: MarketTickerDto
}>()
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n()
const { money, price, pnlClass } = useFormat()
const { busy, closeAll, margin, setTpSl, setAutoClose } = usePositionActions()

const current = computed(() => props.positions.find((p) => p.symbol === props.symbol) ?? null)

const showClose = ref(false)
const showMargin = ref(false)
const showTpSl = ref(false)
const showAuto = ref(false)
const showCloseAll = ref(false)
const tpSlRef = ref<{ valid: boolean } | null>(null)
const marginAction = ref<'add' | 'remove'>('add')
const marginAmount = ref('')
const tp = ref('')
const sl = ref('')
const autoRatio = ref('')
const allowStale = ref(false)

const stale = computed(() => props.ticker.marketState === 'closed' || props.ticker.stale)
const ratio = computed(() => Number(current.value?.marginRatio ?? 0))
const ratioColor = computed(() =>
  ratio.value <= 1
    ? 'bg-rose-500'
    : ratio.value <= marginCallRatio
      ? 'bg-orange-500'
      : ratio.value <= dangerRatio
        ? 'bg-amber-500'
        : ratio.value <= warningRatio
          ? 'bg-yellow-500'
          : 'bg-emerald-500',
)
const ratioPercent = computed(() => Math.min(100, Math.max(0, (ratio.value / 3) * 100)))
const autoCloseRange = computed(() => {
  const min = Number(props.ticker.autoCloseRatioMin ?? '1.05')
  const hardMax = Number(props.ticker.autoCloseRatioMax ?? '5')
  const currentRatio = Number(current.value?.marginRatio ?? 0)
  const max = currentRatio > 0 ? Math.min(hardMax, currentRatio * autoCloseSafety) : 0
  const valid = Number.isFinite(min) && Number.isFinite(max) && max >= min
  return { min, max: valid ? max : min, valid }
})
const autoCloseHint = computed(() =>
  autoCloseRange.value.valid
    ? `${autoCloseRange.value.min.toFixed(2)} – ${autoCloseRange.value.max.toFixed(2)}`
    : t('trade.autoCloseUnavailable'),
)
const autoSaveDisabled = computed(
  () => !autoCloseRange.value.valid && autoRatio.value.trim() !== '',
)

function openMargin(action: 'add' | 'remove') {
  marginAction.value = action
  marginAmount.value = ''
  showMargin.value = true
}

function openTpSl() {
  tp.value = current.value?.takeProfit ?? ''
  sl.value = current.value?.stopLoss ?? ''
  showTpSl.value = true
}
function openAuto() {
  autoRatio.value = current.value?.autoCloseRatio ?? ''
  showAuto.value = true
}

async function doMargin() {
  if (!current.value) return
  await margin(current.value.id, marginAction.value, marginAmount.value)
  showMargin.value = false
}

async function doTpSl() {
  if (!current.value) return
  if (tpSlRef.value && !tpSlRef.value.valid) return
  await setTpSl(current.value.id, {
    takeProfit: tp.value || null,
    stopLoss: sl.value || null,
  })
  showTpSl.value = false
}

async function doAuto() {
  if (!current.value) return
  await setAutoClose(current.value.id, autoRatio.value || null)
  showAuto.value = false
}

async function doCloseAll() {
  await closeAll(allowStale.value)
  showCloseAll.value = false
  emit('changed')
}
</script>

<template>
  <UCard class="border-default bg-elevated">
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="font-medium">{{ t('trade.position') }} · {{ symbol }}</h2>
        <UButton
          v-if="positions.length"
          size="xs"
          color="warning"
          variant="soft"
          @click="showCloseAll = true"
        >
          {{ t('trade.closeAll') }}
        </UButton>
      </div>
    </template>

    <div v-if="!current" class="text-muted py-4 text-sm">{{ t('trade.noPosition') }}</div>
    <div v-else class="space-y-3">
      <div class="flex items-center justify-between">
        <UBadge :color="current.side === 'long' ? 'success' : 'error'" variant="subtle">
          {{ current.side === 'long' ? '▲ ' + t('trade.long') : '▼ ' + t('trade.short') }}
        </UBadge>
        <span class="text-muted text-sm">{{ current.units }} units · {{ current.leverage }}x</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.entry') }}</div>
          <div class="tabular">{{ price(current.entryPrice) }}</div>
        </div>
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.mark') }}</div>
          <div class="tabular">{{ price(current.markPrice) }}</div>
        </div>
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.pnl') }}</div>
          <div class="tabular" :class="pnlClass(current.unrealizedPnl)" data-testid="position-pnl">
            {{ money(current.unrealizedPnl) }} {{ wallet?.currency }}
          </div>
        </div>
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.liq') }}</div>
          <div class="tabular text-rose-300">{{ price(current.liquidationPrice) }}</div>
        </div>
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.margin') }}</div>
          <div class="tabular">{{ money(current.margin) }}</div>
        </div>
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.ratio') }}</div>
          <div class="tabular">{{ current.marginRatio }}</div>
        </div>
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.tp') }}</div>
          <div class="tabular">{{ price(current.takeProfit) }}</div>
        </div>
        <div>
          <div class="text-dimmed text-xs">{{ t('positions.sl') }}</div>
          <div class="tabular">{{ price(current.stopLoss) }}</div>
        </div>
      </div>
      <div>
        <div class="bg-accented h-1.5 overflow-hidden rounded-full">
          <div
            class="h-full transition-all"
            :class="ratioColor"
            :style="{ width: ratioPercent + '%' }"
          />
        </div>
        <div class="text-dimmed mt-1 flex justify-between text-[10px]">
          <span>1.0</span
          ><span>{{ t('positions.autoClose') }}: {{ current.autoCloseRatio ?? '—' }}</span
          ><span>3.0+</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton size="sm" color="error" variant="soft" @click="showClose = true">{{
          t('trade.close')
        }}</UButton>
        <UButton size="sm" color="neutral" variant="soft" @click="openMargin('add')">{{
          t('trade.addMargin')
        }}</UButton>
        <UButton size="sm" color="neutral" variant="soft" @click="openMargin('remove')">{{
          t('trade.removeMargin')
        }}</UButton>
        <UButton size="sm" color="neutral" variant="soft" @click="openTpSl">{{
          t('trade.setTpSl')
        }}</UButton>
        <UButton size="sm" color="neutral" variant="soft" @click="openAuto">{{
          t('trade.autoClose')
        }}</UButton>
      </div>
    </div>

    <PartialCloseDialog
      v-model:open="showClose"
      :position="current"
      :ticker="ticker"
      :stale="stale"
      @changed="emit('changed')"
    />

    <UModal
      v-model:open="showMargin"
      :title="marginAction === 'add' ? t('trade.addMargin') : t('trade.removeMargin')"
    >
      <template #body>
        <UFormField :label="t('common.amount')">
          <UInput
            :model-value="marginAmount"
            type="number"
            min="0.01"
            step="0.01"
            @update:model-value="marginAmount = String($event ?? '')"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showMargin = false">{{
            t('common.cancel')
          }}</UButton>
          <UButton :loading="busy" @click="doMargin">{{ t('common.confirm') }}</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showTpSl" :title="t('trade.setTpSl')">
      <template #body>
        <TpSlFields
          v-if="current"
          ref="tpSlRef"
          v-model:take-profit="tp"
          v-model:stop-loss="sl"
          :side="current.side"
          :reference-price="current.entryPrice"
          :pip-size="ticker.pipSize"
          :price-precision="ticker.pricePrecision"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showTpSl = false">{{
            t('common.cancel')
          }}</UButton>
          <UButton :loading="busy" :disabled="tpSlRef ? !tpSlRef.valid : false" @click="doTpSl">{{
            t('common.save')
          }}</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showAuto" :title="t('trade.autoClose')">
      <template #body>
        <UFormField :label="t('trade.autoClose')" :hint="autoCloseHint">
          <UInput
            :model-value="autoRatio"
            type="number"
            :min="autoCloseRange.min"
            :max="autoCloseRange.max"
            step="0.05"
            placeholder="—"
            @update:model-value="autoRatio = String($event ?? '')"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showAuto = false">{{
            t('common.cancel')
          }}</UButton>
          <UButton :loading="busy" :disabled="autoSaveDisabled" @click="doAuto">{{
            t('common.save')
          }}</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showCloseAll" :title="t('trade.closeAll')">
      <template #body>
        <p class="text-toned text-sm">{{ t('trade.confirmText') }}</p>
        <UCheckbox v-model="allowStale" class="mt-3" :label="t('positions.includeStale')" />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showCloseAll = false">{{
            t('common.cancel')
          }}</UButton>
          <UButton color="warning" :loading="busy" @click="doCloseAll">{{
            t('common.confirm')
          }}</UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
