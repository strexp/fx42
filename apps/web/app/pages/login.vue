<script setup lang="ts">
import type { ProviderDto } from '@fx42/contracts'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const route = useRoute()
const colorMode = useColorMode()
const requestFetch = useRequestFetch()
const { data: providers } = await useAsyncData('providers', () =>
  requestFetch<ProviderDto[]>('/api/auth/providers'),
)
const error = computed(() => (route.query.error ? String(route.query.error) : null))
const redirect = computed(() => (route.query.redirect ? String(route.query.redirect) : '/'))
</script>

<template>
  <UCard class="border-default bg-elevated">
    <div class="mb-6 flex items-center gap-3">
      <img
        :src="colorMode.value === 'dark' ? '/favicon-dark.svg' : '/favicon-light.svg'"
        alt=""
        width="44"
        height="44"
        class="size-11"
      />
      <div>
        <h1 class="text-xl font-semibold">{{ t('auth.title') }}</h1>
        <p class="text-muted text-sm">{{ t('auth.subtitle') }}</p>
      </div>
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      class="mb-4"
      :title="t('auth.failed')"
      :description="error"
    />
    <div class="space-y-3">
      <UButton
        v-for="provider in providers"
        :key="provider.id"
        :to="`/api/auth/oidc/${provider.id}?redirect=${encodeURIComponent(redirect)}`"
        external
        size="lg"
        block
        color="neutral"
        variant="outline"
        :icon="provider.kind === 'dn42' ? 'i-lucide-network' : 'i-lucide-key-round'"
      >
        <span class="flex-1 text-left">{{ provider.displayName }}</span>
        <UBadge
          size="sm"
          variant="subtle"
          :color="provider.kind === 'dn42' ? 'primary' : 'neutral'"
        >
          {{ provider.kind === 'dn42' ? t('auth.dn42') : t('auth.generic') }}
        </UBadge>
      </UButton>
    </div>
  </UCard>
</template>
