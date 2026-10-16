/** Personal interface preferences. They live in this browser only; nothing here is sent to the server. */

export type ThemeChoice = 'system' | 'light' | 'dark' | 'pink'
export type Prefs = {
  theme: ThemeChoice
  density: 'comfortable' | 'compact'
  motion: 'full' | 'reduced'
  priority: 'bars' | 'dots'
}

const KEY = 'taskhub.prefs'
export const DEFAULT_PREFS: Prefs = { theme: 'system', density: 'comfortable', motion: 'full', priority: 'bars' }

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      theme: (['system', 'light', 'dark', 'pink'] as const).includes(raw.theme as ThemeChoice) ? (raw.theme as ThemeChoice) : DEFAULT_PREFS.theme,
      density: raw.density === 'compact' ? 'compact' : 'comfortable',
      motion: raw.motion === 'reduced' ? 'reduced' : 'full',
      priority: raw.priority === 'dots' ? 'dots' : 'bars',
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
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // storage unavailable: the choice applies until the page is reloaded
  }
  applyPrefs(prefs)
}

/** Applies stored preferences and keeps "System" in sync when the OS theme changes. */
export function initPrefs() {
  applyPrefs(readPrefs())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readPrefs().theme === 'system') applyPrefs(readPrefs())
  })
}
