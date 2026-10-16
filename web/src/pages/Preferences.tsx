import { useState } from 'react'
import { Check } from 'lucide-react'
import { PageHeader } from '../components/ui.tsx'
import { readPrefs, savePrefs, type Prefs, type ThemeChoice } from '../prefs.ts'
import { cx } from '../util.ts'

const THEMES: { key: ThemeChoice; label: string; hint: string; swatch: string[] }[] = [
  { key: 'system', label: 'System', hint: 'Follows your device', swatch: ['#ffffff', '#18181b'] },
  { key: 'light', label: 'Light', hint: 'Always light', swatch: ['#ffffff', '#f4f4f5'] },
  { key: 'dark', label: 'Dark', hint: 'Always dark', swatch: ['#18181b', '#0f0f11'] },
  { key: 'pink', label: 'Hyperpink', hint: 'You asked for this', swatch: ['#ff1493', '#ff9ad5'] },
]

export function PreferencesPage() {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)
  const update = (patch: Partial<Prefs>) => {
    // Start from what is stored, so quick successive changes never overwrite each other.
    const next = { ...readPrefs(), ...patch }
    setPrefs(next)
    savePrefs(next)
  }

  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" description="How Taskhub looks for you. Saved in this browser." />

      <section className="card form">
        <div className="field">
          <span className="field-label">Theme</span>
          <div className="theme-grid" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={prefs.theme === t.key}
                className={cx('theme-card', prefs.theme === t.key && 'active', t.key === 'pink' && 'theme-card-pink')}
                onClick={() => update({ theme: t.key })}
              >
                <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} />
                <span className="stack">
                  <span>{t.label}</span>
                  <span className="muted small">{t.hint}</span>
                </span>
                {prefs.theme === t.key && <Check size={16} className="theme-check" />}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Density</span>
          <div className="segmented">
            {(['comfortable', 'compact'] as const).map((d) => (
              <button key={d} type="button" className={cx(prefs.density === d && 'active')} onClick={() => update({ density: d })}>
                {d === 'comfortable' ? 'Comfortable' : 'Compact'}
              </button>
            ))}
          </div>
          <span className="field-hint">Compact fits more tasks on the screen.</span>
        </div>

        <div className="field">
          <span className="field-label">Animations</span>
          <div className="segmented">
            {(['full', 'reduced'] as const).map((m) => (
              <button key={m} type="button" className={cx(prefs.motion === m && 'active')} onClick={() => update({ motion: m })}>
                {m === 'full' ? 'On' : 'Reduced'}
              </button>
            ))}
          </div>
          <span className="field-hint">Turns off sliding panels, fades and glows.</span>
        </div>
      </section>
    </div>
  )
}
