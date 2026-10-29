<script setup lang="ts">
const { t } = useI18n()
const {
  presetId: pnlPresetId,
  presets: pnlPresets,
  up: pnlUp,
  down: pnlDown,
  setPreset: setPnlPreset,
} = usePnlColors()
</script>

<template>
  <UCard class="border-default bg-elevated">
    <template #header
      ><h2 class="font-medium">{{ t('settings.pnlColors') }}</h2></template
    >
    <div class="space-y-4">
      <p class="text-muted text-xs">{{ t('settings.pnlColorsHint') }}</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          v-for="preset in pnlPresets"
          :key="preset.id"
          type="button"
          class="flex items-center justify-between rounded-lg border px-3 py-2 text-left transition"
          :class="
            pnlPresetId === preset.id
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-default hover:border-accented'
          "
          @click="setPnlPreset(preset.id)"
        >
          <span class="flex items-center gap-3">
            <span class="flex gap-1">
              <span class="size-4 rounded-full" :style="{ backgroundColor: preset.up }" />
              <span class="size-4 rounded-full" :style="{ backgroundColor: preset.down }" />
            </span>
            <span class="text-sm">{{ t(`settings.pnlPresets.${preset.id}`) }}</span>
          </span>
          <UIcon
            v-if="pnlPresetId === preset.id"
            name="i-lucide-check"
            class="size-4 text-emerald-400"
          />
        </button>
      </div>
      <div
        class="border-default bg-muted flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
      >
        <span class="text-muted">{{ t('settings.colorPreview') }}</span>
        <span class="flex gap-3">
          <span class="tabular" :style="{ color: pnlUp }">+123.45</span>
          <span class="tabular" :style="{ color: pnlDown }">-67.89</span>
        </span>
      </div>
    </div>
  </UCard>
</template>
