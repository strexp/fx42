<script setup lang="ts">
import type { ScamAccountDto } from '@fx42/contracts'

defineProps<{
  mode: 'real' | 'virtual'
  amount: string
  sourceAccountId: string
  sourceAccounts: ScamAccountDto[]
  hasCredential: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  'update:amount': [value: string]
  'update:sourceAccountId': [value: string]
  deposit: []
}>()
const { t } = useI18n()
</script>

<template>
  <UCard class="border-default bg-elevated">
    <template #header
      ><h2 class="font-medium">{{ t('wallet.deposit') }}</h2></template
    >
    <div class="space-y-3">
      <template v-if="mode === 'real'">
        <UFormField :label="t('wallet.sourceAccount')">
          <USelect
            v-if="sourceAccounts.length"
            :key="'source-' + sourceAccounts.map((a) => a.id).join(',')"
            :model-value="sourceAccountId"
            :items="sourceAccounts.map((a) => ({ label: a.iban, value: a.id }))"
            value-key="value"
            class="w-full"
            @update:model-value="emit('update:sourceAccountId', String($event))"
          />
        </UFormField>
        <p class="text-muted text-xs">{{ t('wallet.autoDepositHint') }}</p>
        <p v-if="hasCredential && !sourceAccounts.length" class="text-xs text-amber-300">
          {{ t('wallet.noSourceAccount') }}
        </p>
      </template>
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
      <UButton
        block
        :loading="busy"
        :disabled="mode === 'real' && (!hasCredential || !sourceAccountId)"
        @click="emit('deposit')"
      >
        {{ mode === 'virtual' ? t('wallet.depositVirtual') : t('wallet.autoDepositButton') }}
      </UButton>
      <p v-if="mode === 'real' && !hasCredential" class="text-xs text-amber-300">
        {{ t('wallet.noToken') }}
      </p>
    </div>
  </UCard>
</template>
