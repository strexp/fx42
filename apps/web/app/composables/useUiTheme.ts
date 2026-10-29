import colors from 'tailwindcss/colors'

export type UiThemeId =
  | 'mono'
  | 'cobalt'
  | 'sky'
  | 'mint'
  | 'iris'
  | 'crimson'
  | 'coral'
  | 'sunset'
  | 'carbon'
  | 'bubblegum'
  | 'parchment'

interface Palette {
  50: string
  100: string
  200: string
  300: string
  400: string
  500: string
  600: string
  700: string
  800: string
  900: string
  950: string
}

export interface UiThemePreset {
  id: UiThemeId
  primary: string
  palette: Palette
  neutral: string
  neutralPalette: Palette
  radius: string
}

const paletteSource =
  (colors as unknown as { default?: Record<string, Palette> }).default ??
  (colors as unknown as Record<string, Palette>)
const p = (name: string): Palette => paletteSource[name]!

export const UI_THEMES: UiThemePreset[] = [
  {
    id: 'mono',
    primary: 'zinc',
    palette: p('zinc'),
    neutral: 'zinc',
    neutralPalette: p('zinc'),
    radius: '0rem',
  },
  {
    id: 'cobalt',
    primary: 'blue',
    palette: p('blue'),
    neutral: 'slate',
    neutralPalette: p('slate'),
    radius: '0.25rem',
  },
  {
    id: 'sky',
    primary: 'sky',
    palette: p('sky'),
    neutral: 'slate',
    neutralPalette: p('slate'),
    radius: '0.5rem',
  },
  {
    id: 'mint',
    primary: 'teal',
    palette: p('teal'),
    neutral: 'slate',
    neutralPalette: p('slate'),
    radius: '0.75rem',
  },
  {
    id: 'iris',
    primary: 'violet',
    palette: p('violet'),
    neutral: 'slate',
    neutralPalette: p('slate'),
    radius: '0.5rem',
  },
  {
    id: 'crimson',
    primary: 'red',
    palette: p('red'),
    neutral: 'gray',
    neutralPalette: p('gray'),
    radius: '0.25rem',
  },
  {
    id: 'coral',
    primary: 'rose',
    palette: p('rose'),
    neutral: 'stone',
    neutralPalette: p('stone'),
    radius: '0.75rem',
  },
  {
    id: 'sunset',
    primary: 'orange',
    palette: p('orange'),
    neutral: 'stone',
    neutralPalette: p('stone'),
    radius: '0.5rem',
  },
  {
    id: 'carbon',
    primary: 'gray',
    palette: p('gray'),
    neutral: 'zinc',
    neutralPalette: p('zinc'),
    radius: '0rem',
  },
  {
    id: 'bubblegum',
    primary: 'pink',
    palette: p('pink'),
    neutral: 'slate',
    neutralPalette: p('slate'),
    radius: '1rem',
  },
  {
    id: 'parchment',
    primary: 'amber',
    palette: p('amber'),
    neutral: 'stone',
    neutralPalette: p('stone'),
    radius: '0.25rem',
  },
]

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export function useUiTheme() {
  const {
    presetId: themeId,
    preset: theme,
    presets: themes,
    load,
    apply,
    applyStored,
    setPreset: setTheme,
  } = useStoredPreset({
    stateKey: 'fx42-ui-theme',
    storageKey: 'fx42-ui-theme',
    presets: UI_THEMES,
    defaultId: 'cobalt',
    apply: (preset) => {
      const root = document.documentElement
      for (const shade of SHADES) {
        root.style.setProperty(`--ui-color-primary-${shade}`, preset.palette[shade])
        root.style.setProperty(`--ui-color-neutral-${shade}`, preset.neutralPalette[shade])
      }
      root.style.setProperty('--ui-primary', preset.palette[500])
      root.style.setProperty('--ui-radius', preset.radius)
    },
  })

  return { themeId, theme, themes, load, apply, applyStored, setTheme }
}
