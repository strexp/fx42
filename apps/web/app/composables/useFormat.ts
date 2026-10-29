export function useFormat() {
  const { t, locale } = useI18n()

  const intlLocale = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))

  function translateOr(prefix: string, key: unknown): string {
    const path = `${prefix}.${String(key)}`
    const label = t(path)
    return label === path ? String(key) : label
  }

  function actionLabel(action: unknown): string {
    return translateOr('history.actions', action)
  }

  function statusColor(status: string): 'success' | 'warning' | 'error' | 'neutral' {
    if (['credited', 'settled', 'sent'].includes(status)) return 'success'
    if (['pending', 'requested', 'sending'].includes(status)) return 'warning'
    if (['failed', 'expired'].includes(status)) return 'error'
    return 'neutral'
  }

  function number(value: string | number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || value === '') return '—'
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    return new Intl.NumberFormat(intlLocale.value, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n)
  }

  function money(value: string | number | null | undefined, digits = 4): string {
    return number(value, digits)
  }

  function price(value: string | number | null | undefined, digits?: number): string {
    if (value === null || value === undefined) return '—'
    const n = Number(value)
    if (!Number.isFinite(n)) return '—'
    const d = digits ?? (n > 1000 ? 2 : n > 10 ? 3 : 5)
    return n.toFixed(d)
  }

  function percent(value: string | number | null | undefined, digits = 2): string {
    if (value === null || value === undefined) return '—'
    return `${number(value, digits)}%`
  }

  function date(value: string | number | null | undefined): string {
    if (!value) return '—'
    return new Intl.DateTimeFormat(intlLocale.value, {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value))
  }

  function dateNoYear(value: string | number | null | undefined): string {
    if (!value) return '—'
    return new Intl.DateTimeFormat(intlLocale.value, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))
  }

  function pnlClass(value: string | number | null | undefined): string {
    const n = Number(value ?? 0)
    return n > 0 ? 'fx-up' : n < 0 ? 'fx-down' : ''
  }

  return {
    number,
    money,
    price,
    percent,
    date,
    dateNoYear,
    pnlClass,
    translateOr,
    actionLabel,
    statusColor,
  }
}
