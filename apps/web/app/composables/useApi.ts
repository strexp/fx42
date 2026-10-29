export function useApi() {
  const { t } = useI18n()
  const toast = useToast()

  async function api<T>(url: string, options: Parameters<typeof $fetch>[1] = {}): Promise<T> {
    try {
      return await $fetch<T>(url, options)
    } catch (error) {
      const err = error as {
        data?: { error?: { code?: string; message?: string; details?: unknown } }
        statusCode?: number
      }
      const code = err.data?.error?.code ?? (err.statusCode === 401 ? 'UNAUTHORIZED' : 'INTERNAL')
      const key = `errors.${code}`
      const translated = t(key)
      toast.add({
        title: translated === key ? (err.data?.error?.message ?? t('common.error')) : translated,
        description:
          import.meta.dev && err.data?.error?.details
            ? JSON.stringify(err.data.error.details)
            : undefined,
        color: 'error',
      })
      if (code === 'UNAUTHORIZED' || code === 'SESSION_INVALID') {
        await navigateTo('/login')
      }
      throw error
    }
  }

  return { api }
}
