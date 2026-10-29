<script setup lang="ts">
import type { ScamAccountDto } from '@fx42/contracts'

defineProps<{
  mode: 'real' | 'virtual'
  amount: string
  destination: string
  scamAccounts: ScamAccountDto[]
  hasCredential: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  'update:amount': [value: string]
  'update:destination': [value: string]
  withdraw: []
}>()
const { t } = useI18n()
</script>

<template>
  <UCard class="border-default bg-elevated">
    <template #header
      ><h2 class="font-medium">{{ t('wallet.withdraw') }}</h2></template
    >
    <div class="space-y-3">
      <UFormField :label="t('wallet.amount')">
        <UInput
          :model-value="amount"
          type="number"
          min="0.01"
          step="0.01"
          class="w-full"
          @update:model-value="emit('update:amount', String($event ?? ''))"
        />
      </UFormField>
      <UFormField v-if="mode === 'real'" :label="t('wallet.destination')">
        <USelect
          v-if="scamAccounts.length"
          :key="'dest-' + scamAccounts.map((a) => a.id).join(',')"
          :model-value="destination"
          :items="scamAccounts.map((a) => ({ label: a.iban, value: a.id }))"
          value-key="value"
          class="w-full"
          @update:model-value="emit('update:destination', String($event))"
        />
      </UFormField>
      <UButton
        block
        :loading="busy"
        :disabled="mode === 'real' && (!hasCredential || !destination)"
        @click="emit('withdraw')"
      >
        {{ mode === 'virtual' ? t('wallet.withdrawVirtual') : t('wallet.withdrawReal') }}
      </UButton>
      <p class="text-dimmed text-xs">
        {{ mode === 'real' ? t('wallet.autoWithdraw') : t('wallet.virtualNotice') }}
      </p>
    </div>
  </UCard>
</template>
