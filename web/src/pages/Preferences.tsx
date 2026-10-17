import { useData } from '../store.tsx'
import type { ReactNode } from 'react'
import { Foldable, PageHeader, PriorityIcon, StatusIcon } from '../components/ui.tsx'
import { readPrefs, savePrefs, usePrefs, useLooks, type Look, type Prefs } from '../prefs.ts'
import { ThemePicker } from '../components/ThemePicker.tsx'
import { Guides } from '../tour/Guides.tsx'
import { ColorPicker } from '../components/ColorPicker.tsx'
import { IconPicker } from '../components/IconPicker.tsx'
import { WORKFLOW_COLORS } from '../components/WorkflowEditors.tsx'
import { cx } from '../util.ts'

export function PreferencesPage() {
  const prefs = usePrefs()
  const { priorities, statuses } = useData()
  const top = priorities[0]
  // Preview with an "in progress" status, where rings, dots and icons differ the most.
  const firstStatus = statuses.find((s) => s.type === 'active') ?? statuses[0]
  const update = (patch: Partial<Prefs>) => {
    // Start from what is stored, so quick successive changes never overwrite each other.
    savePrefs({ ...readPrefs(), ...patch })
  }

  return (
    <div className="page page-narrow">
      <PageHeader title="Settings" description="How Taskhub looks for you. Saved in this browser." />

      <section className="card form" data-tour="theme">
        <ThemePicker />
      </section>

      <section className="card pref-list" data-tour="display">
        <PrefRow label="Density" hint="Compact fits more tasks on the screen" value={prefs.density} onChange={(density) => update({ density })} options={[['comfortable', 'Comfortable'], ['compact', 'Compact']]} />
        <PrefRow label="Animations" hint="Sliding panels, fades and glows" value={prefs.motion} onChange={(motion) => update({ motion })} options={[['full', 'On'], ['reduced', 'Reduced']]} />
        <PrefRow
          label="Status icons"
          hint="How statuses are drawn next to tasks"
          value={prefs.status}
          onChange={(status) => update({ status })}
          options={[
            ['rings', <span key="r" className="pref-icons" data-style="rings">{firstStatus && <StatusIcon id={firstStatus.id} />} Rings</span>],
            ['dots', <span key="d" className="pref-icons" data-style="sdots">{firstStatus && <StatusIcon id={firstStatus.id} />} Dots</span>],
            ['icons', <span key="i" className="pref-icons" data-style="sicons">{firstStatus && <StatusIcon id={firstStatus.id} />} Icons</span>],
          ]}
        />
        <PrefRow
          label="Priority icons"
          hint="How priorities are drawn next to tasks"
          value={prefs.priority}
          onChange={(priority) => update({ priority })}
          options={[
            ['bars', <span key="b" className="pref-icons" data-style="bars">{top && <PriorityIcon id={top.id} />} Bars</span>],
            ['dots', <span key="d" className="pref-icons" data-style="dots">{top && <PriorityIcon id={top.id} />} Dots</span>],
            ['icons', <span key="i" className="pref-icons" data-style="icons">{top && <PriorityIcon id={top.id} />} Icons</span>],
          ]}
        />
      </section>

      <LooksCard />
      <Guides />
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

/** Personal colour and icon for every status and priority. Empty means "use the workspace default". */
function LooksCard() {
  const { statuses, priorities } = useData()
  const prefs = usePrefs()
  const looks = useLooks()

  const setLook = (kind: 'statusLooks' | 'priorityLooks', id: number, patch: Look | null) => {
    const current = readPrefs()
    const map = { ...current[kind] }
    if (patch === null) delete map[id]
    else map[id] = { ...map[id], ...patch }
    savePrefs({ ...current, [kind]: map })
  }

  const anyChanged = Object.keys(prefs.statusLooks).length + Object.keys(prefs.priorityLooks).length > 0

  return (
    <Foldable
      id="looks"
      className="card looks-card"
      tour="looks"
      title="Colors and icons"
      hint="Only for you. Anything you leave alone uses the workspace default."
      actions={
        <button
          type="button"
          className="btn btn-sm"
          disabled={!anyChanged}
          onClick={() => savePrefs({ ...readPrefs(), statusLooks: {}, priorityLooks: {} })}
          title="Every status and priority back to the workspace default"
        >
          Reset all
        </button>
      }
    >
      <LookGroup title="Statuses">
        {statuses.map((s) => (
          <LookRow
            key={s.id}
            name={s.name}
            preview={<StatusIcon id={s.id} size={16} />}
            color={looks.statusColor(s)}
            icon={looks.statusIcon(s)}
            fallbackIcon={s.type === 'done' ? 'circle-check' : s.type === 'active' ? 'loader' : 'circle-dashed'}
            changed={Boolean(prefs.statusLooks[s.id])}
            onColor={(color) => setLook('statusLooks', s.id, { color })}
            onIcon={(icon) => setLook('statusLooks', s.id, { icon })}
            onReset={() => setLook('statusLooks', s.id, null)}
          />
        ))}
      </LookGroup>
      <LookGroup title="Priorities">
        {priorities.map((p) => (
          <LookRow
            key={p.id}
            name={p.name}
            preview={<PriorityIcon id={p.id} />}
            color={looks.priorityColor(p)}
            icon={looks.priorityIcon(p)}
            fallbackIcon="flag"
            changed={Boolean(prefs.priorityLooks[p.id])}
            onColor={(color) => setLook('priorityLooks', p.id, { color })}
            onIcon={(icon) => setLook('priorityLooks', p.id, { icon })}
            onReset={() => setLook('priorityLooks', p.id, null)}
          />
        ))}
      </LookGroup>
    </Foldable>
  )
}

function LookGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="look-group">
      <span className="field-label">{title}</span>
      <ul className="look-list">{children}</ul>
    </div>
  )
}

function LookRow(props: {
  name: string
  preview: ReactNode
  color: string
  icon: string | null
  fallbackIcon: string
  changed: boolean
  onColor: (c: string) => void
  onIcon: (i: string) => void
  onReset: () => void
}) {
  return (
    <li className="look-row">
      <span className="look-preview">{props.preview}</span>
      <span className="truncate look-name">{props.name}</span>
      <IconPicker value={props.icon} fallback={props.fallbackIcon} color={props.color} onChange={props.onIcon} />
      <ColorPicker small value={props.color} presets={WORKFLOW_COLORS} onChange={(c) => c && props.onColor(c)} />
      <button type="button" className="btn btn-sm btn-ghost look-reset" disabled={!props.changed} onClick={props.onReset} title="Back to the workspace default">
        Reset
      </button>
    </li>
  )
}
