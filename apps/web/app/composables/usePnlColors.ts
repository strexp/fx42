export interface PnlPreset {
  id: 'classic' | 'blueRed' | 'tealAmber' | 'purpleOrange'
  up: string
  down: string
}

export const PNL_PRESETS: PnlPreset[] = [
  { id: 'classic', up: '#22c55e', down: '#ef4444' },
  { id: 'blueRed', up: '#38bdf8', down: '#fb7185' },
  { id: 'tealAmber', up: '#2dd4bf', down: '#f59e0b' },
  { id: 'purpleOrange', up: '#a78bfa', down: '#fb923c' },
]

export const DEFAULT_PNL_PRESET = 'classic'

export function usePnlColors() {
  const { presetId, preset, presets, load, apply, applyStored, setPreset } = useStoredPreset({
    stateKey: 'fx42-pnl-preset',
    storageKey: 'fx42-pnl-preset',
    presets: PNL_PRESETS,
    defaultId: DEFAULT_PNL_PRESET,
    apply: (value) => {
      document.documentElement.style.setProperty('--fx42-up', value.up)
      document.documentElement.style.setProperty('--fx42-down', value.down)
    },
  })
  const up = computed(() => preset.value.up)
  const down = computed(() => preset.value.down)

  return {
    presetId,
    preset,
    presets,
    up,
    down,
    load,
    apply,
    applyStored,
    setPreset,
    reset: () => setPreset(DEFAULT_PNL_PRESET),
  }
}
