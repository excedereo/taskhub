/** Personal interface preferences. They live in this browser only; nothing here is sent to the server. */
import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark' | 'pink'

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
}

const KEY = 'taskhub.prefs'
export const DEFAULT_PREFS: Prefs = { theme: 'system', density: 'comfortable', motion: 'full', priority: 'bars', status: 'rings', statusLooks: {}, priorityLooks: {} }

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
      theme: (['system', 'light', 'dark', 'pink'] as const).includes(raw.theme as ThemeChoice) ? (raw.theme as ThemeChoice) : DEFAULT_PREFS.theme,
      density: raw.density === 'compact' ? 'compact' : 'comfortable',
      motion: raw.motion === 'reduced' ? 'reduced' : 'full',
      priority: raw.priority === 'dots' || raw.priority === 'icons' ? raw.priority : 'bars',
      status: raw.status === 'dots' || raw.status === 'icons' ? raw.status : 'rings',
      statusLooks: parseLooks(raw.statusLooks),
      priorityLooks: parseLooks(raw.priorityLooks),
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function applyPrefs(prefs: Prefs) {
  const root = document.documentElement
  root.dataset.theme = prefs.theme === 'system' ? (systemDark() ? 'dark' : 'light') : prefs.theme
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
    if (readPrefs().theme === 'system') applyPrefs(readPrefs())
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
