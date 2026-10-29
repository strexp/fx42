<script setup lang="ts">
import type { UserMeDto } from '@fx42/contracts'

const { t, locale, setLocale } = useI18n()
const { api } = useApi()
const { me, mode, switchMode } = useAccountMode()
const toast = useToast()

const displayName = ref(me.value?.user.displayName ?? '')
const saving = ref(false)

async function saveProfile() {
  saving.value = true
  try {
    const data = await api<UserMeDto>('/api/me', {
      method: 'PATCH',
      body: { displayName: displayName.value, locale: locale.value },
    })
    me.value = data
    toast.add({ title: t('settings.saved'), color: 'success' })
  } finally {
    saving.value = false
  }
}

async function changeLocale(code: string) {
  await setLocale(code as 'zh-CN' | 'en')
  await saveProfile()
}

async function logout(allDevices = false) {
  await $fetch(`/api/auth/logout${allDevices ? '?allDevices=true' : ''}`, { method: 'POST' }).catch(
    () => {},
  )
  useState('fx42-me', () => null).value = null
  await navigateTo('/login')
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">{{ t('settings.title') }}</h1>

    <div class="grid gap-4 xl:grid-cols-2">
      <UCard class="border-default bg-elevated">
        <template #header
          ><h2 class="font-medium">{{ t('settings.profile') }}</h2></template
        >
        <div class="space-y-3">
          <UFormField :label="t('settings.displayName')"
            ><UInput v-model="displayName" class="w-full"
          /></UFormField>
          <UFormField :label="t('settings.language')">
            <USelect
              :model-value="locale"
              :items="[
                { label: t('languages.zh'), value: 'zh-CN' },
                { label: t('languages.en'), value: 'en' },
              ]"
              value-key="value"
              class="w-full"
              @update:model-value="changeLocale(String($event))"
            />
          </UFormField>
          <UFormField :label="t('settings.defaultMode')">
            <USelect
              :model-value="mode"
              :items="[
                { label: t('common.virtual'), value: 'virtual' },
                { label: t('common.real'), value: 'real' },
              ]"
              value-key="value"
              class="w-full"
              @update:model-value="switchMode(String($event) as 'real' | 'virtual')"
            />
          </UFormField>
          <UButton :loading="saving" @click="saveProfile">{{ t('common.save') }}</UButton>
        </div>
      </UCard>

      <SettingsThemeCard />

      <SettingsPnlCard />

      <SettingsNotificationsCard />

      <UCard class="border-default bg-elevated">
        <template #header
          ><h2 class="font-medium">{{ t('settings.scamToken') }}</h2></template
        >
        <p class="text-muted text-sm">{{ t('wallet.bindHint') }}</p>
        <div class="mt-3 flex gap-2">
          <UButton to="/wallet" variant="soft">{{ t('settings.goWallet') }}</UButton>
          <UButton color="error" variant="soft" @click="logout()">{{
            t('settings.logout')
          }}</UButton>
          <UButton color="error" variant="ghost" @click="logout(true)">{{
            t('settings.logoutAll')
          }}</UButton>
        </div>
      </UCard>
    </div>
  </div>
</template>
