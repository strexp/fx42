<script setup lang="ts">
import NumberFlow, { type Format } from '@number-flow/vue'

const props = withDefaults(
  defineProps<{
    value: string | number | null | undefined
    digits?: number
    fallback?: string
    animated?: boolean
  }>(),
  {
    digits: 2,
    fallback: '—',
    animated: true,
  },
)

const { locale } = useI18n()
const { number } = useFormat()

const numeric = computed<number | null>(() => {
  if (props.value === null || props.value === undefined || props.value === '') return null
  const n = Number(props.value)
  return Number.isFinite(n) ? n : null
})

const formatted = computed(() => number(props.value, props.digits))

const format = computed<Format>(() => ({
  minimumFractionDigits: props.digits,
  maximumFractionDigits: props.digits,
}))
</script>

<template>
  <NumberFlow
    v-if="numeric !== null"
    class="tabular"
    :value="numeric"
    :title="formatted"
    :locales="locale"
    :format="format"
    :animated="animated"
    respect-motion-preference
  />
  <span v-else class="tabular">{{ fallback }}</span>
</template>
