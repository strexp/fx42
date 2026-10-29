<script setup lang="ts">
const { t } = useI18n()
const colorMode = useColorMode()
const { themeId, themes, setTheme } = useUiTheme()

type ColorPreference = 'dark' | 'light' | 'system'
const colorPreference = ref<ColorPreference>('dark')

function setColorMode(value: string) {
  colorPreference.value = value as ColorPreference
  colorMode.preference = colorPreference.value
}

watch(
  () => colorMode.preference,
  (value) => {
    if (value === 'dark' || value === 'light' || value === 'system') colorPreference.value = value
  },
  { immediate: true },
)

onNuxtReady(() => {
  const stored = localStorage.getItem('nuxt-color-mode')
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    colorPreference.value = stored
    colorMode.preference = stored
  } else if (
    colorMode.preference === 'dark' ||
    colorMode.preference === 'light' ||
    colorMode.preference === 'system'
  ) {
    colorPreference.value = colorMode.preference
  }
})
</script>

<template>
  <UCard class="border-default bg-elevated">
    <template #header
      ><h2 class="font-medium">{{ t('settings.theme') }}</h2></template
    >
    <div class="space-y-4">
      <p class="text-muted text-xs">{{ t('settings.themeHint') }}</p>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="preset in themes"
          :key="preset.id"
          type="button"
          class="flex items-center justify-between rounded-lg border px-3 py-2 text-left transition"
          :class="
            themeId === preset.id
              ? 'border-primary bg-primary/10'
              : 'border-default hover:border-accented'
          "
          @click="setTheme(preset.id)"
        >
          <span class="flex items-center gap-3">
            <span class="size-4 rounded-full" :style="{ backgroundColor: preset.palette[500] }" />
            <span class="text-sm">{{ t(`settings.themes.${preset.id}`) }}</span>
          </span>
          <UIcon v-if="themeId === preset.id" name="i-lucide-check" class="text-primary size-4" />
        </button>
      </div>
      <UFormField :label="t('settings.colorMode')">
        <div class="grid grid-cols-3 gap-2">
          <UButton
            v-for="item in [
              { value: 'dark', label: t('settings.dark'), icon: 'i-lucide-moon' },
              { value: 'light', label: t('settings.light'), icon: 'i-lucide-sun' },
              { value: 'system', label: t('settings.system'), icon: 'i-lucide-monitor' },
            ]"
            :key="item.value"
            :icon="item.icon"
            :color="colorPreference === item.value ? 'primary' : 'neutral'"
            :variant="colorPreference === item.value ? 'soft' : 'ghost'"
            size="sm"
            @click="setColorMode(item.value)"
          >
            {{ item.label }}
          </UButton>
        </div>
      </UFormField>
    </div>
  </UCard>
</template>
