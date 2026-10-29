<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    color?: 'primary' | 'error' | 'warning' | 'neutral' | 'success' | 'info'
    loading?: boolean
    confirmDisabled?: boolean
  }>(),
  {
    description: '',
    confirmLabel: '',
    cancelLabel: '',
    color: 'primary',
    loading: false,
    confirmDisabled: false,
  },
)

const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [] }>()
const { t } = useI18n()
</script>

<template>
  <UModal :open="open" :title="title" @update:open="emit('update:open', $event)">
    <template #body>
      <slot name="body">
        <p v-if="description" class="text-toned text-sm">{{ description }}</p>
      </slot>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" @click="emit('update:open', false)">
          {{ cancelLabel || t('common.cancel') }}
        </UButton>
        <UButton
          :color="color"
          :loading="loading"
          :disabled="confirmDisabled"
          @click="emit('confirm')"
        >
          {{ confirmLabel || t('common.confirm') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
