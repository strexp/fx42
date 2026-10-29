import type { UserMeDto } from '@fx42/contracts'

export function useAccountMode() {
  const { api } = useApi()
  const mode = useState<'real' | 'virtual'>('fx42-mode', () => 'virtual')
  const me = useState<UserMeDto | null>('fx42-me', () => null)

  async function load(): Promise<UserMeDto | null> {
    try {
      const data = await api<UserMeDto>('/api/me')
      me.value = data
      if (data.user.defaultMode) mode.value = data.user.defaultMode
      return data
    } catch {
      return null
    }
  }

  async function switchMode(next: 'real' | 'virtual') {
    mode.value = next
    if (me.value) {
      try {
        await api('/api/me', { method: 'PATCH', body: { defaultMode: next } })
        me.value.user.defaultMode = next
      } catch {
        // mode still changes locally; preference sync is best-effort
      }
    }
  }

  // The layout/middleware may populate `me` without calling load(); keep the
  // active mode in sync with the saved default in that case.
  watch(
    me,
    (data) => {
      if (data?.user.defaultMode) mode.value = data.user.defaultMode
    },
    { immediate: true },
  )

  return { mode, me, load, switchMode }
}
