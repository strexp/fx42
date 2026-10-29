<script setup lang="ts">
import type { ScamAccountDto } from '@fx42/contracts'

defineProps<{
  credential: { hint: string; scamUsername: string | null; status: string } | null
  scamAccounts: ScamAccountDto[]
  token: string
  bindLoading: boolean
}>()
const emit = defineEmits<{
  'update:token': [value: string]
  bind: []
  unbind: []
  setPrimary: [id: string]
}>()
const { t } = useI18n()

function credentialStatusLabel(status: string): string {
  const key = `wallet.credential${status.charAt(0).toUpperCase()}${status.slice(1)}`
  const label = t(key)
  return label === key ? status : label
}
</script>

<template>
  <UCard class="border-default bg-elevated w-full">
    <template #header
      ><h2 class="font-medium">{{ t('wallet.bindTitle') }}</h2></template
    >
    <template v-if="!credential">
      <p class="text-muted mb-3 text-sm">{{ t('wallet.bindHint') }}</p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput
          :model-value="token"
          type="password"
          class="flex-1"
          :placeholder="t('wallet.token')"
          autocomplete="off"
          @update:model-value="emit('update:token', String($event ?? ''))"
        />
        <UButton :loading="bindLoading" :disabled="token.length < 16" @click="emit('bind')">
          {{ t('wallet.bind') }}
        </UButton>
      </div>
    </template>
    <template v-else>
      <div class="space-y-2 text-sm">
        <div class="flex justify-between">
          <span class="text-muted">{{ t('wallet.hint') }}</span>
          <span class="font-mono">{{ credential.hint }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-muted">{{ t('common.status') }}</span>
          <UBadge
            :color="credential.status === 'active' ? 'success' : 'error'"
            size="sm"
            variant="subtle"
          >
            {{ credentialStatusLabel(credential.status) }}
          </UBadge>
        </div>
        <div
          v-for="a in scamAccounts"
          :key="a.id"
          class="border-default flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div class="font-mono text-xs">{{ a.iban }}</div>
            <div class="text-dimmed text-xs">{{ a.name }} · {{ a.balance ?? '—' }}</div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge v-if="a.isPrimary" color="primary" size="sm" variant="subtle">
              {{ t('wallet.primary') }}
            </UBadge>
            <UButton v-else size="xs" variant="ghost" @click="emit('setPrimary', a.id)">
              {{ t('wallet.setPrimary') }}
            </UButton>
          </div>
        </div>
      </div>
      <UButton class="mt-3" color="error" variant="soft" size="sm" @click="emit('unbind')">
        {{ t('wallet.unbind') }}
      </UButton>
    </template>
  </UCard>
</template>
