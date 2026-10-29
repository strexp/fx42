<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <div class="flex items-center gap-2">
      <UButton to="/" variant="ghost" color="neutral" size="sm" icon="i-lucide-arrow-left">
        {{ t('common.back') }}
      </UButton>
      <h1 class="text-xl font-semibold">{{ t('settings.terms') }}</h1>
    </div>

    <UCard class="border-default bg-elevated">
      <div class="text-toned space-y-4 text-sm leading-7">
        <p class="text-dimmed text-xs">{{ t('terms.readOnly') }}</p>
        <p
          v-for="n in 16"
          :key="n"
          class="whitespace-pre-line first-line:font-semibold"
          v-text="t(`terms.p${n}`)"
        />
        <img
          src="/meme.jpg"
          alt=""
          width="512"
          height="512"
          loading="lazy"
          class="mx-auto mt-6 block w-full max-w-56 rounded-xl"
        />
      </div>
    </UCard>
  </div>
</template>
