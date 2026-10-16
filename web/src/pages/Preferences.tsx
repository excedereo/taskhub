import { useState } from 'react'
import { Check, Settings2 } from 'lucide-react'
import { useData } from '../store.tsx'
import { PrioritiesModal } from '../components/PrioritiesModal.tsx'
import type { ReactNode } from 'react'
import { PageHeader, PriorityIcon } from '../components/ui.tsx'
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
  const [editingPriorities, setEditingPriorities] = useState(false)
  const { priorities, can } = useData()
  const top = priorities[0]
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

      </section>

      <section className="card pref-list">
        <PrefRow label="Density" hint="Compact fits more tasks on the screen" value={prefs.density} onChange={(density) => update({ density })} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} />
        <PrefRow label="Animations" hint="Sliding panels, fades and glows" value={prefs.motion} onChange={(motion) => update({ motion })} options={[['full', 'On'], ['reduced', 'Reduced']]} />
        <PrefRow
          label="Priority icons"
          hint="How priorities are drawn next to tasks"
          value={prefs.priority}
          onChange={(priority) => update({ priority })}
          action={
            can('manage_settings') && (
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditingPriorities(true)} aria-label="Edit priorities" title="Edit priorities">
                <Settings2 size={14} />
              </button>
            )
          }
          options={[
            ['bars', <span key="b" className="pref-icons" data-style="bars">{top && <PriorityIcon id={top.id} />} Bars</span>],
            ['dots', <span key="d" className="pref-icons" data-style="dots">{top && <PriorityIcon id={top.id} />} Dots</span>],
          ]}
        />
      </section>
      {editingPriorities && <PrioritiesModal onClose={() => setEditingPriorities(false)} />}
    </div>
  )
}

/** One compact line per small preference: label and hint on the left, a small switch on the right. */
function PrefRow<T extends string>({ label, hint, value, options, onChange, action }: { label: string; hint: string; value: T; options: [T, ReactNode][]; onChange: (v: T) => void; action?: ReactNode }) {
  return (
    <div className="pref-row">
      <span className="stack min-w-0 grow">
        <span>{label}</span>
        <span className="muted small">{hint}</span>
      </span>
      {action}
      <div className="segmented segmented-sm">
        {options.map(([key, text]) => (
          <button key={key} type="button" className={cx(value === key && 'active')} onClick={() => onChange(key)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
