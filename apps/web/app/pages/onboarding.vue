<script setup lang="ts">
import type { UserMeDto } from '@fx42/contracts'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
const { api } = useApi()
const me = useState<UserMeDto | null>('fx42-me', () => null)
const accepted = ref(false)
const mode = ref<'real' | 'virtual'>('virtual')
const loading = ref(false)
const scrolled = ref(false)

if (!me.value) {
  me.value = await useRequestFetch()<UserMeDto>('/api/me').catch(() => null)
}

async function submit() {
  if (!accepted.value) return
  loading.value = true
  try {
    await api('/api/onboarding/accept', { method: 'POST', body: { mode: mode.value } })
    if (me.value) {
      me.value.user.termsAccepted = true
      me.value.user.defaultMode = mode.value
      me.value.user.accounts = [
        { id: 'pending-real', mode: 'real', currency: 'FTK', status: 'active' },
        { id: 'pending-virtual', mode: 'virtual', currency: 'VFTK', status: 'active' },
      ]
    }
    await navigateTo('/')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
    <UCard class="border-default bg-elevated">
      <template #header>
        <h1 class="text-xl font-semibold">{{ t('onboarding.title') }}</h1>
        <p class="text-muted mt-1 text-sm">{{ t('onboarding.subtitle') }}</p>
      </template>
      <div
        class="border-default bg-muted text-toned max-h-[45vh] space-y-4 overflow-y-auto rounded-lg border p-4 text-sm leading-6 lg:max-h-[62vh]"
        @scroll="scrolled = true"
      >
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
      <p v-if="!scrolled" class="mt-2 text-xs text-amber-300">{{ t('onboarding.scrollHint') }}</p>
      <label class="mt-4 flex items-start gap-3 text-sm">
        <input v-model="accepted" type="checkbox" class="mt-1 size-4 accent-emerald-500" />
        <span>{{ t('onboarding.accept') }}</span>
      </label>
    </UCard>

    <UCard class="border-default bg-elevated lg:sticky lg:top-20">
      <template #header>
        <h2 class="font-medium">{{ t('onboarding.chooseMode') }}</h2>
      </template>
      <div class="grid gap-3">
        <button
          class="rounded-xl border p-4 text-left transition"
          :class="
            mode === 'virtual'
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-default hover:border-accented'
          "
          @click="mode = 'virtual'"
        >
          <div class="font-medium">{{ t('onboarding.virtual') }}</div>
          <div class="text-muted mt-1 text-xs">{{ t('wallet.virtualNotice') }}</div>
        </button>
        <button
          class="rounded-xl border p-4 text-left transition"
          :class="
            mode === 'real'
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-default hover:border-accented'
          "
          @click="mode = 'real'"
        >
          <div class="font-medium">{{ t('onboarding.real') }}</div>
          <div class="text-muted mt-1 text-xs">{{ t('wallet.noToken') }}</div>
        </button>
      </div>
      <UButton
        class="mt-4"
        block
        size="lg"
        :disabled="!accepted"
        :loading="loading"
        @click="submit"
      >
        {{ t('onboarding.continue') }}
      </UButton>
    </UCard>
  </div>
</template>
