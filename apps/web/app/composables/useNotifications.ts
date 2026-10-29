import type { NotificationItem } from '@fx42/contracts'

export function useNotifications() {
  const { api } = useApi()
  const items = useState<NotificationItem[]>('fx42-notifications', () => [])
  const unread = computed(() => items.value.filter((n) => !n.readAt).length)

  async function load() {
    try {
      const data = await api<{ items: NotificationItem[] }>('/api/me/notifications')
      items.value = data.items
    } catch {
      items.value = []
    }
  }

  async function markAllRead() {
    await api('/api/me/notifications/read', { method: 'POST', body: {} })
    await load()
  }

  return { items, unread, load, markAllRead }
}
