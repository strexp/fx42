<script setup lang="ts">
const colorMode = useColorMode()
const { locale } = useI18n()

useHead(() => ({
  htmlAttrs: { lang: locale.value },
  meta: [
    { name: 'theme-color', content: colorMode.value === 'dark' ? '#0b0f14' : '#ffffff' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-title', content: 'FX42' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black' },
  ],
  link: [
    {
      rel: 'icon',
      type: 'image/svg+xml',
      href: colorMode.value === 'dark' ? '/favicon-dark.svg' : '/favicon-light.svg',
    },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/icons/apple-touch-icon.png' },
    { rel: 'manifest', href: '/manifest.webmanifest' },
  ],
}))
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
