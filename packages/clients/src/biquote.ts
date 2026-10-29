import { ofetch } from 'ofetch'

export interface BiquoteTick {
  symbol: string
  bid: string
  ask: string
  mid: string
  marketState: 'open' | 'closed'
  stale: boolean
  quoteAgeSeconds: number
  sourceTs: number
  description?: string
  digits?: number
}

export interface BiquoteCandle {
  openTime: number
  open: string
  high: string
  low: string
  close: string
  volume: number | null
  isOpen: boolean
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

function parseTick(raw: Record<string, unknown>): BiquoteTick | null {
  const symbol = str(raw.symbol ?? raw.Symbol ?? raw.s)
  if (!symbol) return null
  const bid = str(raw.bid ?? raw.Bid)
  const ask = str(raw.ask ?? raw.Ask)
  const mid = str(raw.mid ?? raw.Mid)
  if (!bid || !ask || !mid) return null
  const stateRaw = str(raw.marketState ?? raw.market_state ?? raw.state) ?? 'open'
  const age = Number(raw.quoteAgeSeconds ?? raw.quote_age_seconds ?? 0)
  const tsRaw = raw.timestamp ?? raw.sourceTs ?? raw.source_ts ?? raw.time
  let sourceTs = 0
  if (typeof tsRaw === 'number') sourceTs = tsRaw < 1e12 ? tsRaw * 1000 : tsRaw
  else if (typeof tsRaw === 'string') {
    const parsed = Date.parse(tsRaw)
    sourceTs = Number.isFinite(parsed) ? parsed : 0
  }
  return {
    symbol: symbol.toUpperCase(),
    bid,
    ask,
    mid,
    marketState: stateRaw === 'closed' ? 'closed' : 'open',
    stale: Boolean(raw.stale),
    quoteAgeSeconds: Number.isFinite(age) ? age : 0,
    sourceTs: sourceTs || Date.now(),
    description: str(raw.description) ?? undefined,
    digits: raw.digits === undefined ? undefined : Number(raw.digits),
  }
}

function parseCandle(raw: Record<string, unknown>): BiquoteCandle | null {
  const openTimeRaw = raw.openTime ?? raw.open_time ?? raw.time ?? raw.t
  let openTime: number
  if (typeof openTimeRaw === 'number') openTime = openTimeRaw > 1e12 ? openTimeRaw : openTimeRaw * 1000
  else if (typeof openTimeRaw === 'string') {
    const num = Number(openTimeRaw)
    if (Number.isFinite(num)) openTime = num > 1e12 ? num : num * 1000
    else {
      const parsed = Date.parse(openTimeRaw)
      if (!Number.isFinite(parsed)) return null
      openTime = parsed
    }
  } else return null
  const open = str(raw.open ?? raw.o)
  const high = str(raw.high ?? raw.h)
  const low = str(raw.low ?? raw.l)
  const close = str(raw.close ?? raw.c)
  if (!open || !high || !low || !close) return null
  const volumeRaw = raw.volume ?? raw.v ?? raw.tickVolume
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: volumeRaw === undefined || volumeRaw === null ? null : Number(volumeRaw),
    isOpen: Boolean(raw.isOpen ?? raw.is_open),
  }
}

export class BiquoteClient {
  private readonly client: typeof ofetch
  constructor(readonly baseUrl: string) {
    this.client = ofetch.create({ baseURL: baseUrl.replace(/\/$/, ''), timeout: 5000, retry: 2 })
  }

  async latest(symbols: string[]): Promise<BiquoteTick[]> {
    if (!symbols.length) return []
    const query = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join('&')
    const raw = await this.client<unknown>(`/api/latest?${query}`)
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: unknown[] }).data)
        : Array.isArray((raw as { ticks?: unknown }).ticks)
          ? ((raw as { ticks: unknown[] }).ticks)
          : raw && typeof raw === 'object'
            ? Object.values(raw as Record<string, unknown>).filter(
                (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v),
              )
            : []
    return (list as Record<string, unknown>[]).map(parseTick).filter((t): t is BiquoteTick => !!t)
  }

  async ticker(symbol: string): Promise<BiquoteTick | null> {
    try {
      const raw = await this.client<unknown>(`/api/${encodeURIComponent(symbol)}`)
      const obj = (raw as { data?: Record<string, unknown> }).data ?? (raw as Record<string, unknown>)
      return parseTick(obj)
    } catch {
      return null
    }
  }

  async ohlc(symbol: string, interval: string, limit = 500): Promise<BiquoteCandle[]> {
    const raw = await this.client<unknown>(
      `/api/${encodeURIComponent(symbol)}/ohlc?interval=${encodeURIComponent(interval)}&limit=${limit}`,
    )
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { bars?: unknown }).bars)
        ? ((raw as { bars: unknown[] }).bars)
        : Array.isArray((raw as { candles?: unknown }).candles)
          ? ((raw as { candles: unknown[] }).candles)
          : Array.isArray((raw as { data?: unknown }).data)
            ? ((raw as { data: unknown[] }).data)
            : []
    return (list as Record<string, unknown>[])
      .map(parseCandle)
      .filter((c): c is BiquoteCandle => !!c)
      .sort((a, b) => a.openTime - b.openTime)
  }

  async symbols(type?: string): Promise<Array<Record<string, unknown>>> {
    const suffix = type ? `?type=${encodeURIComponent(type)}` : ''
    const raw = await this.client<unknown>(`/api/symbols${suffix}`)
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>
    const maybe = (raw as { symbols?: unknown }).symbols
    return Array.isArray(maybe) ? (maybe as Array<Record<string, unknown>>) : []
  }
}
