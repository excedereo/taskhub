/**
 * Themes beyond plain Light and Dark. A theme is a base (light or dark) plus six colours;
 * every other token is mixed from them, so no combination can leave a token unset.
 * Workspace themes may add CSS on top for effects.
 */

export type ThemeBase = 'light' | 'dark'
export type ThemeColors = { bg: string; surface: string; text: string; accent: string; border: string; danger: string }
export type ThemeDef = { base: ThemeBase; colors: ThemeColors; css?: string }

export const COLOR_FIELDS: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: 'bg', label: 'Background', hint: 'Behind everything' },
  { key: 'surface', label: 'Panels', hint: 'Cards, lists, menus' },
  { key: 'text', label: 'Text', hint: 'Muted text is mixed from it' },
  { key: 'accent', label: 'Accent', hint: 'Primary buttons and highlights' },
  { key: 'border', label: 'Borders', hint: 'Lines between things' },
  { key: 'danger', label: 'Danger', hint: 'Errors and destructive actions' },
]

/** The colours of the stock Light and Dark themes, used as the starting point for new themes. */
export const BASE_COLORS: Record<ThemeBase, ThemeColors> = {
  light: { bg: '#ffffff', surface: '#ffffff', text: '#18181b', accent: '#18181b', border: '#e7e7ea', danger: '#dc2626' },
  dark: { bg: '#0f0f11', surface: '#18181b', text: '#ededef', accent: '#ededef', border: '#26262b', danger: '#f87171' },
}

export const BUILTIN_THEMES: { key: string; name: string; def: ThemeDef }[] = [
  { key: 'midnight', name: 'Midnight', def: { base: 'dark', colors: { bg: '#0a0f1e', surface: '#10172b', text: '#e3e8f6', accent: '#6ea8ff', border: '#1d2643', danger: '#ff6b6b' } } },
  { key: 'forest', name: 'Forest', def: { base: 'dark', colors: { bg: '#0b1310', surface: '#111c16', text: '#e1ede5', accent: '#4ade80', border: '#1e2d24', danger: '#f87171' } } },
  { key: 'paper', name: 'Paper', def: { base: 'light', colors: { bg: '#f4eee2', surface: '#fbf8f1', text: '#2b2620', accent: '#b4532a', border: '#e2d8c4', danger: '#c2410c' } } },
  { key: 'frost', name: 'Frost', def: { base: 'light', colors: { bg: '#eef2f7', surface: '#ffffff', text: '#1f2a37', accent: '#3b6fd6', border: '#d9e0ea', danger: '#d23c3c' } } },
]

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Accepts only complete, well-formed colour sets; anything else falls back to the base theme's colours. */
export function parseColors(value: unknown, base: ThemeBase): ThemeColors {
  const out = { ...BASE_COLORS[base] }
  if (value && typeof value === 'object') {
    for (const f of COLOR_FIELDS) {
      const v = (value as Record<string, unknown>)[f.key]
      if (isHex(v)) out[f.key] = v.toLowerCase()
    }
  }
  return out
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
/** `amount` of b mixed into a. */
const mix = (a: string, b: string, amount: number) => {
  const [x, y] = [rgb(a), rgb(b)]
  return toHex(x.map((v, i) => v + (y[i] - v) * amount))
}
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Every token the app reads, derived from the six colours. */
export function themeTokens({ colors: c, base }: ThemeDef): Record<string, string> {
  const faint = mix(c.text, c.surface, 0.6)
  return {
    '--bg': c.bg,
    '--bg-subtle': mix(c.bg, c.text, 0.03),
    '--surface': c.surface,
    '--hover': mix(c.surface, c.text, 0.05),
    '--active': mix(c.surface, c.text, 0.09),
    '--border': c.border,
    '--border-strong': mix(c.border, c.text, 0.18),
    '--text': c.text,
    '--text-muted': mix(c.text, c.surface, 0.4),
    '--text-faint': faint,
    '--primary': c.accent,
    '--primary-text': luminance(c.accent) > 0.4 ? '#18181b' : '#ffffff',
    '--danger': c.danger,
    '--danger-bg': mix(c.surface, c.danger, base === 'dark' ? 0.16 : 0.08),
    '--focus': faint,
    'accent-color': c.accent,
    'color-scheme': base,
  }
}

/** The stylesheet for a theme: its tokens on :root, then its own CSS so that can override them. */
export function themeStylesheet(def: ThemeDef) {
  const vars = Object.entries(themeTokens(def)).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  return `:root {\n${vars}\n}\n${def.css ?? ''}`
}

/** Two colours for a preview swatch. */
export const swatchOf = (def: ThemeDef) => [def.colors.bg, def.colors.accent]
