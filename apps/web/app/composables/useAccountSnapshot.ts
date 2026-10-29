import {
  createSharedComposable,
  useDocumentVisibility,
  useEventSource,
  useIntervalFn,
} from '@vueuse/core'
import type { AccountSnapshotDto, PositionDto, WalletDto } from '@fx42/contracts'

const VISIBLE_REFRESH_MS = 2000
const HIDDEN_REFRESH_MS = 8000
const FALLBACK_REFRESH_MS = 5000

function parseSnapshot(value?: string): AccountSnapshotDto | null {
  if (!value) return null
  try {
    return JSON.parse(value) as AccountSnapshotDto
  } catch {
    return null
  }
}

const useAccountSnapshotShared = createSharedComposable(() => {
  const { mode } = useAccountMode()
  const requestFetch = useRequestFetch()
  const snapshot = useState<AccountSnapshotDto | null>('fx42-account-snapshot', () => null)
  const connected = useState<boolean>('fx42-account-connected', () => false)
  const lastUpdated = useState<number>('fx42-account-updated', () => 0)
  const visibility = useDocumentVisibility()
  const active = ref(false)

  const wallet = computed<WalletDto | null>(() => snapshot.value?.wallet ?? null)
  const positions = computed<PositionDto[]>(() => snapshot.value?.positions ?? [])

  function positionFor(symbol: string): PositionDto | null {
    return positions.value.find((p) => p.symbol === symbol) ?? null
  }

  function apply(next: AccountSnapshotDto): void {
    if (next.mode !== mode.value) return
    const current = snapshot.value
    if (current) {
      if (next.serverTime < current.serverTime) return
      if (next.serverTime === current.serverTime && next.sequence < current.sequence) return
    }
    snapshot.value = next
    lastUpdated.value = next.serverTime
  }

  async function refresh(): Promise<void> {
    const targetMode = mode.value
    try {
      const next = await requestFetch<AccountSnapshotDto>(
        `/api/account/snapshot?mode=${targetMode}`,
      )
      if (next.mode === targetMode) apply(next)
    } catch {
      // Keep the last snapshot; the SSE connection or fallback poll will retry.
    }
  }

  function reset(): void {
    snapshot.value = null
    lastUpdated.value = 0
    connected.value = false
  }

  const streamInterval = computed(() => {
    if (!active.value) return 0
    return visibility.value === 'visible' ? VISIBLE_REFRESH_MS : HIDDEN_REFRESH_MS
  })

  const streamUrl = computed(() =>
    streamInterval.value === 0
      ? undefined
      : `/api/stream/account?mode=${mode.value}&interval=${streamInterval.value}`,
  )

  const fallback = useIntervalFn(() => void refresh(), FALLBACK_REFRESH_MS, { immediate: false })

  const { data, status } = useEventSource(streamUrl, ['snapshot'], {
    immediate: false,
    serializer: { read: parseSnapshot },
  })

  watch(data, (next) => {
    if (next) apply(next)
  })

  watch(streamUrl, (url) => {
    if (!url) fallback.pause()
  })

  watch(status, (next) => {
    connected.value = next === 'OPEN'
    if (next === 'OPEN') {
      fallback.pause()
      void refresh()
    } else if (next === 'CLOSED' && streamUrl.value) {
      fallback.resume()
    }
  })

  function start(): void {
    active.value = true
  }

  function stop(): void {
    active.value = false
    fallback.pause()
    connected.value = false
  }

  return {
    snapshot,
    wallet,
    positions,
    positionFor,
    connected,
    lastUpdated,
    refresh,
    reset,
    start,
    stop,
  }
})

export function useAccountSnapshot() {
  return useAccountSnapshotShared()
}
