<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import type { UserMeDto } from '@fx42/contracts'

const { me, mode, switchMode, load } = useAccountMode()
const { locale, setLocale, t } = useI18n()
const { api } = useApi()
const { items: notifications, unread, load: loadNotifications, markAllRead } = useNotifications()
const {
  snapshot,
  wallet,
  refresh: refreshAccount,
  reset: resetAccount,
  start: startAccount,
  stop: stopAccount,
} = useAccountSnapshot()
const colorMode = useColorMode()
const route = useRoute()
const notificationsOpen = ref(false)
const unreadNotifications = computed(() => notifications.value.filter((n) => !n.readAt))

watch(notificationsOpen, (open) => {
  if (open) void loadNotifications()
})
useIntervalFn(() => void loadNotifications(), 15_000, { immediate: false })

if (!me.value) await load()
if (me.value?.user.locale && me.value.user.locale !== locale.value) {
  await setLocale(me.value.user.locale)
}
if (!snapshot.value) await refreshAccount()
const status = ref<{
  haltOpening: boolean
  haltAll: boolean
  feedConnected: boolean
  weekend: boolean
  reserveCoverageOk: boolean | null
  mode: string
} | null>(null)

async function refreshStatus() {
  try {
    status.value = await api('/api/system/status')
  } catch {
    // banner data is best-effort
  }
}

watch(mode, async () => {
  resetAccount()
  await refreshAccount()
  startAccount()
  await refreshStatus()
})
useIntervalFn(() => void refreshStatus(), 5_000, { immediate: false })
onMounted(async () => {
  startAccount()
  await refreshStatus()
  await loadNotifications()
})
onBeforeUnmount(stopAccount)

const nav = computed(() => [
  { to: '/', label: t('nav.dashboard'), icon: 'i-lucide-layout-dashboard' },
  { to: '/markets', label: t('nav.markets'), icon: 'i-lucide-chart-candlestick' },
  { to: '/positions', label: t('nav.positions'), icon: 'i-lucide-layers' },
  { to: '/wallet', label: t('nav.wallet'), icon: 'i-lucide-wallet' },
  { to: '/history', label: t('nav.history'), icon: 'i-lucide-history' },
  { to: '/settings', label: t('nav.settings'), icon: 'i-lucide-settings' },
])

const isDark = computed(() => colorMode.value === 'dark')

function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  useState('fx42-me', () => null).value = null
  await navigateTo('/login')
}

async function logoutAll() {
  await $fetch('/api/auth/logout?allDevices=true', { method: 'POST' }).catch(() => {})
  useState('fx42-me', () => null).value = null
  await navigateTo('/login')
}

async function changeLocale(code: string) {
  await setLocale(code as 'zh-CN' | 'en')
  if (me.value) {
    try {
      me.value = await api<UserMeDto>('/api/me', {
        method: 'PATCH',
        body: { locale: code },
      })
    } catch {
      // keep the local language even if the preference could not be saved
    }
  }
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

const userItems = computed(() => [
  [
    {
      label: me.value?.user.displayName ?? me.value?.user.activeMnt ?? 'FX42',
      type: 'label' as const,
    },
  ],
  [
    { label: t('settings.terms'), icon: 'i-lucide-file-text', to: '/terms' },
    { label: t('nav.settings'), icon: 'i-lucide-settings', to: '/settings' },
    { label: t('settings.logout'), icon: 'i-lucide-log-out', onSelect: logout },
    { label: t('settings.logoutAll'), icon: 'i-lucide-shield-off', onSelect: logoutAll },
  ],
])
</script>

<template>
  <div class="bg-default min-h-screen">
    <header class="border-default bg-default sticky top-0 z-40 border-b backdrop-blur">
      <div class="mx-auto flex h-14 max-w-7xl items-center gap-4 px-3 sm:px-5">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold tracking-tight">
          <BadgeDollarIcon class="text-primary size-8" />
          <span class="text-primary">FX42</span>
        </NuxtLink>
        <nav class="hidden items-center gap-1 lg:flex">
          <UButton
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :icon="item.icon"
            :color="
              route.path === item.to || (item.to !== '/' && route.path.startsWith(item.to))
                ? 'primary'
                : 'neutral'
            "
            variant="ghost"
            size="sm"
          >
            {{ item.label }}
          </UButton>
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <div class="hidden text-right sm:block">
            <div class="text-dimmed text-[10px] tracking-wide uppercase">
              {{ t('wallet.equity') }}
            </div>
            <div class="flex items-baseline gap-1 text-sm font-semibold">
              <AnimatedMoney :value="wallet?.equity" :digits="2" />
              <span class="text-dimmed text-xs">{{ wallet?.currency }}</span>
            </div>
          </div>
          <UBadge
            v-if="status?.mode === 'mock'"
            color="warning"
            variant="subtle"
            class="hidden sm:inline-flex"
          >
            {{ t('app.demoBadge') }}
          </UBadge>
          <div class="border-default hidden items-center rounded-lg border p-0.5 sm:flex">
            <button
              class="rounded-md px-2.5 py-1 text-xs font-medium"
              :class="mode === 'virtual' ? 'bg-accented text-highlighted' : 'text-muted'"
              @click="switchMode('virtual')"
            >
              {{ t('common.virtual') }}
            </button>
            <button
              class="rounded-md px-2.5 py-1 text-xs font-medium"
              :class="mode === 'real' ? 'bg-emerald-500 text-slate-950' : 'text-muted'"
              @click="switchMode('real')"
            >
              {{ t('common.real') }}
            </button>
          </div>
          <UPopover v-model:open="notificationsOpen" :content="{ align: 'end', sideOffset: 8 }">
            <div class="relative">
              <UButton
                icon="i-lucide-bell"
                variant="ghost"
                :color="unread ? 'primary' : 'neutral'"
                size="sm"
                :aria-label="t('settings.notifications')"
              />
              <span
                v-if="unread"
                class="ring-default pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-rose-500 ring-2"
                data-testid="notification-unread-dot"
              />
            </div>
            <template #content>
              <div class="w-80 max-w-[calc(100vw-2rem)]">
                <div class="border-muted flex items-center justify-between border-b px-3 py-2">
                  <div class="text-sm font-medium">{{ t('settings.notifications') }}</div>
                  <UButton size="xs" variant="ghost" :disabled="!unread" @click="markAllRead">
                    {{ t('settings.markAllRead') }}
                  </UButton>
                </div>
                <NotificationList
                  :items="unreadNotifications"
                  :empty-text="t('notifications.emptyUnread')"
                />
              </div>
            </template>
          </UPopover>
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
          <UDropdownMenu :items="userItems">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-lucide-user-round"
              :aria-label="t('nav.accountMenu')"
            />
          </UDropdownMenu>
        </div>
      </div>
      <div class="border-muted overflow-x-auto border-t px-3 py-1.5 lg:hidden">
        <div class="mx-auto flex w-max items-center gap-1">
          <UButton
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            size="xs"
            variant="ghost"
            :color="route.path === item.to ? 'primary' : 'neutral'"
          >
            {{ item.label }}
          </UButton>
        </div>
      </div>
    </header>

    <div
      v-if="mode === 'virtual'"
      class="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-800 dark:border-amber-500/20 dark:text-amber-200"
    >
      {{ t('app.virtualBanner') }}
    </div>
    <div
      v-if="status?.haltAll"
      class="border-b border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-center text-xs text-rose-800 dark:text-rose-200"
    >
      {{ t('app.haltAll') }}
    </div>
    <div
      v-else-if="status?.haltOpening"
      class="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-800 dark:border-amber-500/20 dark:text-amber-200"
    >
      {{ t('app.haltOpening') }}
    </div>
    <div
      v-if="status && !status.feedConnected"
      class="border-b border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-center text-xs text-orange-800 dark:border-orange-500/20 dark:text-orange-200"
    >
      {{ t('app.feedStale') }}
    </div>
    <div
      v-if="status?.weekend"
      class="border-b border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-center text-xs text-sky-800 dark:border-sky-500/20 dark:text-sky-200"
    >
      {{ t('app.weekend') }}
    </div>

    <main class="mx-auto max-w-7xl px-3 py-5 sm:px-5">
      <slot />
    </main>
  </div>
</template>
