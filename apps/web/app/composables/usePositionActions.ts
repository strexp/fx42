export function usePositionActions() {
  const { api } = useApi()
  const { mode } = useAccountMode()
  const { refresh } = useAccountSnapshot()
  const { t } = useI18n()
  const toast = useToast()
  const busy = ref(false)

  async function closeAll(allowStale: boolean) {
    busy.value = true
    try {
      const result = await api<{ closed: unknown[]; failed: Array<{ code: string }> }>(
        '/api/positions/close-all',
        { method: 'POST', body: { mode: mode.value, allowStale } },
      )
      if (result.failed.length) {
        toast.add({
          title: t('positions.partialResult'),
          description: result.failed
            .map((item) => {
              const key = `errors.${item.code}`
              const label = t(key)
              return label === key ? item.code : label
            })
            .join(', '),
          color: 'warning',
        })
      } else {
        toast.add({ title: t('positions.closed'), color: 'success' })
      }
      await refresh()
      return result
    } finally {
      busy.value = false
    }
  }

  async function closeOne(positionId: string, confirmStale = false, units?: string) {
    busy.value = true
    try {
      const result = await api(`/api/positions/${positionId}/close`, {
        method: 'POST',
        body: {
          units,
          confirmStale,
          clientOrderId: `close-web-${crypto.randomUUID()}`,
        },
      })
      await refresh()
      return result
    } finally {
      busy.value = false
    }
  }

  async function margin(positionId: string, action: 'add' | 'remove', amount: string) {
    busy.value = true
    try {
      const result = await api(`/api/positions/${positionId}/margin`, {
        method: 'POST',
        body: { action, amount },
      })
      await refresh()
      return result
    } finally {
      busy.value = false
    }
  }

  async function setTpSl(
    positionId: string,
    input: { takeProfit?: string | null; stopLoss?: string | null },
  ) {
    busy.value = true
    try {
      const result = await api(`/api/positions/${positionId}/tpsl`, {
        method: 'PUT',
        body: input,
      })
      await refresh()
      return result
    } finally {
      busy.value = false
    }
  }

  async function setAutoClose(positionId: string, autoCloseRatio: string | null) {
    busy.value = true
    try {
      const result = await api(`/api/positions/${positionId}/auto-close`, {
        method: 'PUT',
        body: { autoCloseRatio },
      })
      await refresh()
      return result
    } finally {
      busy.value = false
    }
  }

  return { busy, closeAll, closeOne, margin, setTpSl, setAutoClose }
}
