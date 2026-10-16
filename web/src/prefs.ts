/** Personal interface preferences. They live in this browser only; nothing here is sent to the server. */
import { useSyncExternalStore } from 'react'
import { BASE_COLORS, BUILTIN_THEMES, parseColors, themeStylesheet, type ThemeBase, type ThemeDef } from './themes.ts'

/** system, light, dark, custom, builtin:<key> or ws:<id> (a workspace theme). */
export type ThemeChoice = string

/** The workspace theme in use, kept here so it applies before the server answers (and on the sign-in page). */
export type WorkspaceThemeCache = { id: number; name: string; base: ThemeBase; colors: ThemeDef['colors']; css: string; updatedAt: number }

/** A personal colour and/or icon for one status or priority; missing fields use the workspace default. */
export type Look = { color?: string; icon?: string }

export type Prefs = {
  theme: ThemeChoice
  density: 'comfortable' | 'compact'
  motion: 'full' | 'reduced'
  priority: 'bars' | 'dots' | 'icons'
  status: 'rings' | 'dots' | 'icons'
  statusLooks: Record<number, Look>
  priorityLooks: Record<number, Look>
  custom: ThemeDef
  wsTheme: WorkspaceThemeCache | null
}

const KEY = 'taskhub.prefs'
export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  density: 'comfortable',
  motion: 'full',
  priority: 'bars',
  status: 'rings',
  statusLooks: {},
  priorityLooks: {},
  custom: { base: 'dark', colors: BASE_COLORS.dark },
  wsTheme: null,
}

// "pink" is the old built-in Hyperpink; it now lives on as a workspace theme and is matched by name.
const THEME_CHOICE = /^(system|light|dark|custom|pink|builtin:[a-z]+|ws:\d+)$/
/** Where the ready stylesheet is cached for the inline script in index.html. */
const CSS_KEY = 'taskhub.theme-css'

function parseCustom(value: unknown): ThemeDef {
  const v = (value ?? {}) as Partial<ThemeDef>
  const base: ThemeBase = v.base === 'light' ? 'light' : 'dark'
  return { base, colors: parseColors(v.colors, base) }
}

function parseWsTheme(value: unknown): WorkspaceThemeCache | null {
  const v = value as Partial<WorkspaceThemeCache> | null
  if (!v || typeof v.id !== 'number' || (v.base !== 'light' && v.base !== 'dark')) return null
  return { id: v.id, name: String(v.name ?? ''), base: v.base, colors: parseColors(v.colors, v.base), css: typeof v.css === 'string' ? v.css : '', updatedAt: Number(v.updatedAt) || 0 }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/** Keeps only well-formed entries, so a hand-edited or old value can never break rendering. */
function parseLooks(value: unknown): Record<number, Look> {
  const out: Record<number, Look> = {}
  if (!value || typeof value !== 'object') return out
  for (const [id, look] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(id) || !look || typeof look !== 'object') continue
    const { color, icon } = look as Look
    const clean: Look = {}
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) clean.color = color
    if (typeof icon === 'string' && /^[a-z0-9-]{1,40}$/.test(icon)) clean.icon = icon
    if (clean.color || clean.icon) out[Number(id)] = clean
  }
  return out
}

export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      theme: typeof raw.theme === 'string' && THEME_CHOICE.test(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
      density: raw.density === 'compact' ? 'compact' : 'comfortable',
      motion: raw.motion === 'reduced' ? 'reduced' : 'full',
      priority: raw.priority === 'dots' || raw.priority === 'icons' ? raw.priority : 'bars',
      status: raw.status === 'dots' || raw.status === 'icons' ? raw.status : 'rings',
      statusLooks: parseLooks(raw.statusLooks),
      priorityLooks: parseLooks(raw.priorityLooks),
      custom: parseCustom(raw.custom),
      wsTheme: parseWsTheme(raw.wsTheme),
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/** Opening any page with ?safe skips the workspace theme for that visit, in case its CSS breaks the page. */
const safeMode = () => new URLSearchParams(window.location.search).has('safe')

let preview: ThemeDef | null = null

/** Shows a theme without choosing it (the editor's live preview); null goes back to the chosen one. */
export function previewTheme(def: ThemeDef | null) {
  preview = def
  applyPrefs(readPrefs())
}

/** The theme to draw: a plain base name, or a full definition. */
export function resolveTheme(prefs: Prefs): ThemeBase | ThemeDef {
  if (preview) return preview
  const t = prefs.theme
  if (t === 'light' || t === 'dark') return t
  if (t === 'custom') return prefs.custom
  if (t.startsWith('builtin:')) {
    const found = BUILTIN_THEMES.find((b) => b.key === t.slice(8))
    if (found) return found.def
  }
  if (t.startsWith('ws:') && prefs.wsTheme && `ws:${prefs.wsTheme.id}` === t && !safeMode()) return prefs.wsTheme
  return systemDark() ? 'dark' : 'light'
}

export function applyPrefs(prefs: Prefs) {
  const root = document.documentElement
  const theme = resolveTheme(prefs)
  root.dataset.theme = typeof theme === 'string' ? theme : theme.base
  const css = typeof theme === 'string' ? '' : themeStylesheet(theme)
  let style = document.getElementById('taskhub-theme')
  if (css) {
    if (!style) {
      style = document.createElement('style')
      style.id = 'taskhub-theme'
    }
    if (style.textContent !== css) style.textContent = css
    // Last in <head>, so theme CSS wins over the app's own rules of the same weight.
    if (style.parentNode !== document.head || document.head.lastElementChild !== style) document.head.appendChild(style)
  } else {
    style?.remove()
  }
  if (!preview) {
    try {
      if (css) localStorage.setItem(CSS_KEY, JSON.stringify({ theme: prefs.theme, base: root.dataset.theme, css }))
      else localStorage.removeItem(CSS_KEY)
    } catch {
      // storage unavailable: the theme still applies once the app has loaded
    }
  }
  root.dataset.density = prefs.density
  root.dataset.motion = prefs.motion
  root.dataset.priority = prefs.priority
  root.dataset.status = prefs.status
}

// A tiny store so components re-render when preferences change (colours and icons are drawn in React).
let current: Prefs | null = null
const listeners = new Set<() => void>()
const snapshot = () => (current ??= readPrefs())
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // storage unavailable: the choice applies until the page is reloaded
  }
  current = prefs
  applyPrefs(prefs)
  listeners.forEach((fn) => fn())
}

/** Current preferences, re-rendering the component when they change. */
export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, snapshot)
}

/** Applies stored preferences and keeps "System" in sync when the OS theme changes. */
export function initPrefs() {
  applyPrefs(readPrefs())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const t = readPrefs().theme
    if (t === 'system' || (t.startsWith('ws:') && !readPrefs().wsTheme)) applyPrefs(readPrefs())
  })
}

type Item = { id: number; color: string; icon: string | null }

/** What a status or priority looks like for this person: their own colour and icon, or the workspace default. */
export function useLooks() {
  const prefs = usePrefs()
  return {
    statusColor: (s: Item) => prefs.statusLooks[s.id]?.color ?? s.color,
    statusIcon: (s: Item) => prefs.statusLooks[s.id]?.icon ?? s.icon,
    priorityColor: (p: Item) => prefs.priorityLooks[p.id]?.color ?? p.color,
    priorityIcon: (p: Item) => prefs.priorityLooks[p.id]?.icon ?? p.icon,
  }
}

export type WorkspaceTheme = WorkspaceThemeCache

/**
 * Brings the cached workspace theme up to date with the server's list. A deleted theme falls back
 * to System; the old built-in Hyperpink choice moves to a workspace theme of the same name if there is one.
 */
export function syncWorkspaceThemes(list: WorkspaceTheme[]) {
  const prefs = readPrefs()
  let next = prefs
  if (prefs.theme === 'pink') {
    const pink = list.find((t) => t.name.toLowerCase() === 'hyperpink')
    next = { ...prefs, theme: pink ? `ws:${pink.id}` : 'system' }
  }
  if (next.theme.startsWith('ws:')) {
    const found = list.find((t) => `ws:${t.id}` === next.theme)
    next = found ? { ...next, wsTheme: found } : { ...next, theme: 'system', wsTheme: null }
  }
  if (JSON.stringify(next) !== JSON.stringify(prefs)) savePrefs(next)
}
