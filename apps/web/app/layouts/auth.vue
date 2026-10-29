<script setup lang="ts">
const { locale, setLocale, t } = useI18n()
const colorMode = useColorMode()
const route = useRoute()
const isDark = computed(() => colorMode.value === 'dark')
const isOnboarding = computed(() => route.path.endsWith('/onboarding'))
const contentWidth = computed(() => (isOnboarding.value ? 'max-w-5xl' : 'max-w-md'))

function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

async function changeLocale(code: string) {
  await setLocale(code as 'zh-CN' | 'en')
}

const languageItems = computed(() => [
  [
    {
      label: t('languages.zh'),
      icon: locale.value === 'zh-CN' ? 'i-lucide-check' : undefined,
      onSelect: () => changeLocale('zh-CN'),
    },
    {
      label: t('languages.en'),
      icon: locale.value === 'en' ? 'i-lucide-check' : undefined,
      onSelect: () => changeLocale('en'),
    },
  ],
])
</script>

<template>
  <div
    class="bg-default grid min-h-screen px-4"
    :class="isOnboarding ? 'items-start justify-items-center py-16' : 'place-items-center'"
  >
    <div class="fixed top-4 right-4 z-10 flex items-center gap-2">
      <UButton
        :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
        variant="ghost"
        color="neutral"
        size="sm"
        :aria-label="t('nav.toggleTheme')"
        @click="toggleColorMode"
      />
      <UDropdownMenu :items="languageItems">
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-lucide-languages"
          :aria-label="t('nav.language')"
        />
      </UDropdownMenu>
    </div>
    <div class="w-full" :class="contentWidth">
      <slot />
    </div>
  </div>
</template>
