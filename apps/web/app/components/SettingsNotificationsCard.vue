<script setup lang="ts">
const { t } = useI18n()
const { items, markAllRead, load } = useNotifications()
onMounted(load)
</script>

<template>
  <UCard class="border-default bg-elevated">
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="font-medium">{{ t('settings.notifications') }}</h2>
        <UButton size="xs" variant="ghost" @click="markAllRead">{{
          t('settings.markAllRead')
        }}</UButton>
      </div>
    </template>
    <NotificationList :items="items" />
  </UCard>
</template>
