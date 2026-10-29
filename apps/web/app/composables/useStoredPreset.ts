export interface StoredPreset {
  id: string
}

/**
 * Shared localStorage-backed preset state used by the UI theme and PnL color
 * pickers. The caller only supplies the preset list and how to paint it.
 */
export function useStoredPreset<T extends StoredPreset>(options: {
  stateKey: string
  storageKey: string
  presets: readonly T[]
  defaultId: string
  apply: (preset: T) => void
}) {
  const presetId = useState<string>(options.stateKey, () => options.defaultId)
  const preset = computed(
    () => options.presets.find((item) => item.id === presetId.value) ?? options.presets[0]!,
  )

  function readStored(): T | null {
    if (!import.meta.client) return null
    try {
      const stored = localStorage.getItem(options.storageKey)
      return options.presets.find((item) => item.id === stored) ?? null
    } catch {
      return null
    }
  }

  function apply(preset: T): void {
    if (import.meta.client) options.apply(preset)
  }

  function applyStored(): void {
    apply(readStored() ?? preset.value)
  }

  function load(): void {
    const stored = readStored()
    if (stored) presetId.value = stored.id
    apply(preset.value)
  }

  function setPreset(id: string): void {
    const next = options.presets.find((item) => item.id === id)
    if (!next) return
    presetId.value = id
    if (import.meta.client) localStorage.setItem(options.storageKey, id)
    apply(next)
  }

  return {
    presetId,
    preset,
    presets: options.presets,
    load,
    apply: () => apply(preset.value),
    applyStored,
    setPreset,
  }
}
