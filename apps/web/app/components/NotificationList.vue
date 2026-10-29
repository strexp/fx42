<script setup lang="ts">
import type { NotificationItem, NotificationKind } from '@fx42/contracts'

defineProps<{
  items: NotificationItem[]
  emptyText?: string
}>()

const { t } = useI18n()
const { date } = useFormat()

function notificationLabel(kind: NotificationKind): string {
  const key = `notifications.${kind}`
  const label = t(key)
  return label === key ? t('notifications.generic') : label
}

const SUBTITLE_KEYS: Record<string, string> = {
  'weekend.margin': 'weekendMargin',
  'weekend.closed': 'weekendClosed',
  'financing.unpaid': 'financingUnpaid',
  'risk.recalculated': 'riskRecalculated',
  'position.closed': 'positionClosed',
  liquidation: 'liquidation',
  bad_debt: 'badDebt',
  'deposit.credited': 'depositCredited',
  'withdrawal.sent': 'withdrawalSent',
  'withdrawal.failed': 'withdrawalFailed',
  'reserve.coverage': 'reserveCoverage',
}

function closeReasonLabel(reason: unknown): string {
  const key = `notifications.closeReasons.${String(reason)}`
  const label = t(key)
  return label === key ? t('notifications.closeReasons.generic') : label
}

function notificationSubtitle(kind: NotificationKind, payload: Record<string, unknown>): string {
  const value = (key: string): string => {
    const raw = payload[key]
    return raw === null || raw === undefined || raw === '' ? '—' : String(raw)
  }
  const position = value('positionId')
  const params = {
    symbol: value('symbol'),
    position: position === '—' ? position : position.slice(0, 8),
    ratio: value('ratio'),
    required: value('required'),
    margin: value('margin'),
    amount: value(kind === 'bad_debt' ? 'badDebt' : 'amount'),
    price: value('closePrice'),
    penalty: value('penalty'),
    reason: kind === 'position.closed' ? closeReasonLabel(payload.reason) : value('reason'),
    realized: value('realized'),
    coverage: value('coverage'),
    mmr:
      value('maintenanceRatioBps') === '—'
        ? '—'
        : (Number(payload.maintenanceRatioBps) / 100).toFixed(2),
  }
  const key = kind.startsWith('margin.') ? 'margin' : (SUBTITLE_KEYS[kind] ?? 'generic')
  const fullKey = `notifications.subtitles.${key}`
  const text = t(fullKey, params)
  return text === fullKey ? t('notifications.subtitles.generic') : text
}
</script>

<template>
  <div class="max-h-96 overflow-y-auto">
    <div v-if="!items.length" class="text-dimmed py-6 text-center text-xs">
      {{ emptyText ?? t('common.empty') }}
    </div>
    <div
      v-for="n in items"
      :key="n.id"
      class="border-muted border-b px-3 py-2 text-sm last:border-0"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-medium">{{ notificationLabel(n.kind) }}</div>
          <div class="text-muted mt-0.5 text-xs">{{ notificationSubtitle(n.kind, n.payload) }}</div>
        </div>
        <UBadge v-if="!n.readAt" color="primary" size="sm" variant="subtle">
          {{ t('notifications.new') }}
        </UBadge>
      </div>
      <div class="text-dimmed mt-1 text-[10px]">{{ date(n.createdAt) }}</div>
    </div>
  </div>
</template>
