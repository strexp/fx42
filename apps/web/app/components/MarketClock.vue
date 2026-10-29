<script setup lang="ts">
interface Session {
  name: string
  timezone: string
  open: boolean
  opensAt: string | null
  closesAt: string | null
}
const { data } = await useAsyncData('market-sessions', () => useRequestFetch()<Session[]>('/api/market-sessions'), {
  server: false,
})
const { t } = useI18n()
const { dateNoYear } = useFormat()
const labels: Record<string, string> = {
  Sydney: 'markets.sydney',
  Tokyo: 'markets.tokyo',
  London: 'markets.london',
  NewYork: 'markets.newYork',
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <div
      v-for="session in data ?? []"
      :key="session.name"
      class="flex min-w-32 flex-1 items-center justify-between gap-3 rounded-lg border border-default bg-elevated px-3 py-2"
    >
      <div>
        <div class="text-xs text-muted">{{ t(labels[session.name] ?? session.name) }}</div>
        <div class="text-xs text-dimmed">
          {{ session.open ? t('markets.closesIn') : t('markets.opensIn') }}
          {{ dateNoYear(session.open ? session.closesAt : session.opensAt) }}
        </div>
      </div>
      <UBadge :color="session.open ? 'success' : 'neutral'" variant="subtle" size="sm">
        {{ session.open ? t('common.open') : t('common.closed') }}
      </UBadge>
    </div>
  </div>
</template>
