<script setup lang="ts">
import { INTERVAL_MS } from '@fx42/shared'
import type { PositionDto } from '@fx42/contracts'

const props = defineProps<{
  symbol: string
  interval: string
  pricePrecision?: number
  marketState?: 'open' | 'closed'
  price?: string | null
  position?: PositionDto | null
}>()

const { t } = useI18n()
const { api } = useApi()
const colorMode = useColorMode()
const { up: pnlUp, down: pnlDown } = usePnlColors()
const container = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
let chart: any = null
let candleSeries: any = null
let maSeries: Record<string, any> = {}
let priceLines: any[] = []
let chartLib: any = null
let liveBar: { time: number; open: number; high: number; low: number; close: number } | null = null
const MA_COLORS = ['#eab308', '#3b82f6', '#a855f7', '#94a3b8', '#f97316', '#14b8a6']
const maLegend = ref<Array<{ key: string; color: string }>>([])

const chartPrecision = computed(() => props.pricePrecision ?? 5)

function priceFormat() {
  return {
    type: 'price' as const,
    precision: chartPrecision.value,
    minMove: 10 ** -chartPrecision.value,
  }
}

function applyPriceFormat() {
  const format = priceFormat()
  candleSeries?.applyOptions({ priceFormat: format })
  for (const series of Object.values(maSeries)) series.applyOptions({ priceFormat: format })
}

async function load() {
  if (!container.value) return
  loading.value = true
  error.value = null
  try {
    const data = await api<{
      bars: Array<{
        t: number
        o: string
        h: string
        l: string
        c: string
        v: number | null
        isOpen: boolean
      }>
      mas: Record<string, Array<{ t: number; v: string | null }>>
      priceUnit: 'FTK'
    }>(`/api/markets/${props.symbol}/candles?interval=${props.interval}&limit=300`)
    if (!chartLib) chartLib = await import('lightweight-charts')
    if (!chart) initChart()
    applyPriceFormat()
    const bars = data.bars.map((b) => ({
      time: b.t as any,
      open: Number(b.o),
      high: Number(b.h),
      low: Number(b.l),
      close: Number(b.c),
    }))
    candleSeries.setData(bars)
    liveBar = bars.length ? { ...bars[bars.length - 1] } : null
    const { LineSeries } = chartLib
    for (const [key, points] of Object.entries(data.mas)) {
      let series = maSeries[key]
      if (!series) {
        const color = MA_COLORS[maLegend.value.length % MA_COLORS.length]!
        series = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: priceFormat(),
        })
        maSeries[key] = series
        maLegend.value = [...maLegend.value, { key, color }]
      }
      const values = points
        .filter((v) => v.v !== null)
        .map((v) => ({
          time: v.t as any,
          value: Number(v.v),
        }))
      series.setData(values)
    }
    chart.timeScale().fitContent()
    chart.timeScale().applyOptions({ barSpacing: 8 })
    updatePriceLines()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function chartTheme() {
  const dark = colorMode.value === 'dark'
  return {
    text: dark ? '#94a3b8' : '#475569',
    grid: dark ? '#1e293b' : '#e2e8f0',
    border: dark ? '#334155' : '#cbd5e1',
  }
}

function applyChartTheme() {
  if (!chart) return
  const theme = chartTheme()
  chart.applyOptions({
    layout: { background: { color: 'transparent' }, textColor: theme.text },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderColor: theme.border },
    timeScale: { borderColor: theme.border },
  })
}

function initChart() {
  const { createChart, CandlestickSeries, CrosshairMode } = chartLib
  const theme = chartTheme()
  chart = createChart(container.value!, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: theme.text },
    grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
    rightPriceScale: { borderColor: theme.border },
    timeScale: { borderColor: theme.border, timeVisible: true },
    crosshair: { mode: CrosshairMode.Normal },
  })
  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: pnlUp.value,
    downColor: pnlDown.value,
    borderVisible: false,
    wickUpColor: pnlUp.value,
    wickDownColor: pnlDown.value,
    priceFormat: priceFormat(),
  })
}

function updatePriceLines() {
  if (!candleSeries || !props.position) return
  for (const line of priceLines) candleSeries.removePriceLine(line)
  priceLines = []
  const add = (price: string | null | undefined, color: string, title: string, style = 2) => {
    if (!price) return
    priceLines.push(
      candleSeries.createPriceLine({
        price: Number(price),
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: true,
        title,
      }),
    )
  }
  add(props.position.entryPrice, '#38bdf8', t('positions.entry'))
  add(props.position.liquidationPrice, '#ef4444', t('positions.liq'))
  add(props.position.takeProfit, '#22c55e', t('positions.tp'))
  add(props.position.stopLoss, '#f97316', t('positions.sl'))
}

watch(() => [props.symbol, props.interval], load)
watch(
  () => props.price,
  (mid) => {
    if (!mid || !candleSeries) return
    if (props.marketState === 'closed') return
    const value = Number(mid)
    const step = INTERVAL_MS[props.interval] ?? 60_000
    const bucket = (Math.floor(Date.now() / step) * step) / 1000
    if (!liveBar) {
      liveBar = { time: bucket, open: value, high: value, low: value, close: value }
    } else if (bucket > liveBar.time) {
      liveBar = { time: bucket, open: liveBar.close, high: value, low: value, close: value }
    } else if (bucket < liveBar.time) {
      return
    } else {
      liveBar.high = Math.max(liveBar.high, value)
      liveBar.low = Math.min(liveBar.low, value)
      liveBar.close = value
    }
    candleSeries.update({ ...liveBar })
  },
)
watch(() => colorMode.value, applyChartTheme)
watch(chartPrecision, applyPriceFormat)
watch([pnlUp, pnlDown], ([up, down]) => {
  candleSeries?.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down })
})
watch(
  () => [
    props.position?.id,
    props.position?.entryPrice,
    props.position?.liquidationPrice,
    props.position?.takeProfit,
    props.position?.stopLoss,
  ],
  updatePriceLines,
)
onMounted(() => {
  load()
})
onBeforeUnmount(() => {
  chart?.remove()
  chart = null
  candleSeries = null
  maSeries = {}
  maLegend.value = []
  liveBar = null
})
</script>

<template>
  <div class="relative h-[420px] w-full">
    <div ref="container" class="h-full w-full" />
    <div
      v-if="loading"
      class="bg-muted text-muted absolute inset-0 grid place-items-center text-sm"
    >
      {{ $t('common.loading') }}
    </div>
    <div v-if="error" class="absolute inset-0 grid place-items-center text-sm text-rose-400">
      {{ error }}
    </div>
    <div class="pointer-events-none absolute top-2 left-2 flex gap-2 text-[10px]">
      <span v-for="item in maLegend" :key="item.key" :style="{ color: item.color }">{{
        item.key.toUpperCase()
      }}</span>
    </div>
  </div>
</template>
