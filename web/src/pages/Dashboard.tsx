import { useCallback, useEffect, useState } from 'react'
import { GripVertical, LayoutDashboard, Pencil, Plus, Settings2, X } from 'lucide-react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import { cx } from '../util.ts'
import { ConfirmButton, Field, Modal, PageHeader } from '../components/ui.tsx'
import { Select } from '../components/Select.tsx'
import { AutoTextarea } from '../components/AutoTextarea.tsx'
import { useToast } from '../components/Toast.tsx'
import { moveItem, useDragSort } from '../components/useDragSort.ts'
import { METRICS, WIDGETS, num, str, titleOf, type DashData, type Widget, type WidgetSize, type WidgetType } from '../dashboard/model.ts'
import { RENDERERS } from '../dashboard/widgets.tsx'

const PERIODS = [7, 30, 90] as const
const PERIOD_KEY = 'taskhub.analytics-period'
const SIZES: [WidgetSize, string][] = [
  ['quarter', '¼'],
  ['half', '½'],
  ['full', 'Full'],
]

function readPeriod() {
  try {
    const v = Number(localStorage.getItem(PERIOD_KEY))
    return (PERIODS as readonly number[]).includes(v) ? v : 30
  } catch {
    return 30
  }
}

/** One dashboard for the whole workspace, built from widgets by people who may manage it. */
export function DashboardPage() {
  const toast = useToast()
  const { can } = useData()
  const [days, setDays] = useState(readPeriod)
  const [layout, setLayout] = useState<{ widgets: Widget[]; custom: boolean } | null>(null)
  const [data, setData] = useState<DashData | null>(null)
  const [draft, setDraft] = useState<Widget[] | null>(null)

  const load = useCallback(() => {
    api.get<{ widgets: Widget[]; custom: boolean }>('/dashboard').then(setLayout).catch(toast.error)
    api.get<DashData>('/dashboard/data').then(setData).catch(toast.error)
  }, [toast])
  useEffect(load, [load])

  useEffect(() => {
    try {
      localStorage.setItem(PERIOD_KEY, String(days))
    } catch {
      // the choice just won't be remembered
    }
  }, [days])

  const save = async (widgets: Widget[] | null) => {
    try {
      setLayout(await api.put<{ widgets: Widget[]; custom: boolean }>('/dashboard', { widgets }))
      setDraft(null)
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="page dashboard">
      <PageHeader
        title="Dashboard"
        actions={
          draft ? null : (
            <>
              <div className="segmented" role="tablist" aria-label="Period">
                {PERIODS.map((p) => (
                  <button key={p} role="tab" aria-selected={days === p} className={cx(days === p && 'active')} onClick={() => setDays(p)}>
                    {p} days
                  </button>
                ))}
              </div>
              {can('manage_dashboard') && layout && (
                <button className="btn btn-ghost" onClick={() => setDraft(layout.widgets)}>
                  <Pencil size={14} /> Edit layout
                </button>
              )}
            </>
          )
        }
      />

      {draft ? (
        <LayoutEditor draft={draft} setDraft={setDraft} custom={Boolean(layout?.custom)} onSave={() => save(draft)} onReset={() => save(null)} onCancel={() => setDraft(null)} />
      ) : !layout || !data ? (
        <div className="skeleton-list">
          <div className="skeleton-row" style={{ height: 96 }} />
          <div className="skeleton-row" style={{ height: 260 }} />
        </div>
      ) : (
        <div className="dash-board">
          {layout.widgets.map((w) => {
            const Render = RENDERERS[w.type]
            return (
              <section key={w.id} className={cx('card dash-widget', `size-${w.size}`, `type-${w.type}`)}>
                <h2 className="dash-title">{titleOf(w)}</h2>
                <Render widget={w} data={data} days={days} />
              </section>
            )
          })}
          {layout.widgets.length === 0 && (
            <div className="card dash-widget size-full">
              <p className="muted">The dashboard is empty.{can('manage_dashboard') ? ' Use Edit layout to add widgets.' : ''}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

let seq = 0
const newId = (type: WidgetType) => `${type}-${Date.now().toString(36)}-${++seq}`

/** Arrange the dashboard as a list: drag by the handle, pick a size, open a widget's settings. */
function LayoutEditor({ draft, setDraft, custom, onSave, onReset, onCancel }: { draft: Widget[]; setDraft: (w: Widget[]) => void; custom: boolean; onSave: () => void; onReset: () => void; onCancel: () => void }) {
  const sort = useDragSort(draft.length, (from, to) => setDraft(moveItem(draft, from, to)))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const update = (id: string, patch: Partial<Widget>) => setDraft(draft.map((w) => (w.id === id ? { ...w, ...patch } : w)))

  return (
    <div className="dash-editor">
      <div className="dash-editor-bar">
        <span className="muted small">Drag widgets by the handle to reorder them. Changes are seen by everyone once saved.</span>
        <span className="grow" />
        {custom && (
          <ConfirmButton className="btn-sm" confirmText="Back to default?" onConfirm={onReset}>
            Reset to default
          </ConfirmButton>
        )}
        <button className="btn btn-sm" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add widget
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={onSave}>
          Save layout
        </button>
      </div>

      <ul className="dash-editor-list">
        {draft.map((w, i) => (
          <li key={w.id} ref={sort.ref(i)} style={sort.style(i)} className={cx('dash-editor-item', sort.dragging === i && 'is-dragging')}>
            <button type="button" className="grip" aria-label={`Drag ${titleOf(w)}`} title="Drag to reorder" {...sort.handle(i)}>
              <GripVertical size={14} />
            </button>
            <span className="stack min-w-0 grow">
              <span className="truncate">{titleOf(w)}</span>
              <span className="muted small truncate">{WIDGETS[w.type].title}</span>
            </span>
            <div className="segmented segmented-sm" aria-label="Size">
              {SIZES.map(([size, label]) => (
                <button key={size} type="button" className={cx(w.size === size && 'active')} onClick={() => update(w.id, { size })} title={size === 'full' ? 'Full width' : `${label} of the width`}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(w.id)} aria-label={`Settings of ${titleOf(w)}`} title="Settings">
              <Settings2 size={14} />
            </button>
            <button type="button" className="icon-btn icon-btn-sm" onClick={() => setDraft(draft.filter((x) => x.id !== w.id))} aria-label={`Remove ${titleOf(w)}`} title="Remove">
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>

      {adding && (
        <Modal title="Add a widget" onClose={() => setAdding(false)} width={560}>
          <ul className="widget-picker">
            {(Object.keys(WIDGETS) as WidgetType[]).map((type) => (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => {
                    const w: Widget = { id: newId(type), type, size: WIDGETS[type].size, config: { ...WIDGETS[type].config } }
                    setDraft([...draft, w])
                    setAdding(false)
                    setEditing(w.id)
                  }}
                >
                  <LayoutDashboard size={16} className="muted" />
                  <span className="stack min-w-0">
                    <span>{WIDGETS[type].title}</span>
                    <span className="muted small">{WIDGETS[type].description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {editing && draft.find((w) => w.id === editing) && (
        <WidgetSettings widget={draft.find((w) => w.id === editing)!} onChange={(config) => update(editing, { config })} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

/** The settings each kind of widget understands. Every field is optional; empty means "all". */
function WidgetSettings({ widget, onChange, onClose }: { widget: Widget; onChange: (config: Record<string, unknown>) => void; onClose: () => void }) {
  const { categories, labels } = useData()
  const c = widget.config
  const set = (patch: Record<string, unknown>) => onChange({ ...c, ...patch })
  const active = categories.filter((x) => !x.archived)
  const categoryField = (label = 'Category') => (
    <Field label={label}>
      <Select<number | null> aria-label={label} value={num(c.categoryId)} onChange={(v) => set({ categoryId: v })} options={[{ value: null, label: 'All categories' }, ...active.map((x) => ({ value: x.id, label: x.name }))]} />
    </Field>
  )
  const labelField = labels.length > 0 && (
    <Field label="Label">
      <Select<number | null> aria-label="Label" value={num(c.labelId)} onChange={(v) => set({ labelId: v })} options={[{ value: null, label: 'Any label' }, ...labels.map((l) => ({ value: l.id, label: l.name }))]} />
    </Field>
  )

  return (
    <Modal
      title={`${WIDGETS[widget.type].title} settings`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="form">
        <Field label="Title" hint="Leave empty to use the default">
          <input className="input" value={str(c.title)} maxLength={60} onChange={(e) => set({ title: e.target.value })} placeholder={titleOf({ ...widget, config: { ...c, title: '' } })} />
        </Field>

        {widget.type === 'number' && (
          <>
            <Field label="What to count" hint={METRICS.find((m) => m.value === (str(c.metric) || 'open'))?.hint}>
              <Select aria-label="What to count" value={str(c.metric) || 'open'} onChange={(v) => set({ metric: v })} options={METRICS.map((m) => ({ value: m.value, label: m.label }))} />
            </Field>
            {categoryField()}
            {labelField}
          </>
        )}

        {widget.type === 'countdown' && (
          <>
            <Field label="Count down to">
              <Select
                aria-label="Count down to"
                value={str(c.target) || 'deadline'}
                onChange={(v) => set({ target: v })}
                options={[
                  { value: 'deadline', label: 'The next deadline' },
                  { value: 'date', label: 'A date and time' },
                  { value: 'task', label: 'A task’s due date' },
                ]}
              />
            </Field>
            {(str(c.target) || 'deadline') === 'deadline' && categoryField('Deadlines in')}
            {str(c.target) === 'date' && (
              <Field label="Date and time">
                <input className="input" type="datetime-local" value={str(c.date)} onChange={(e) => set({ date: e.target.value })} />
              </Field>
            )}
            {str(c.target) === 'task' && (
              <Field label="Task number" hint="The number after #">
                <input className="input" inputMode="numeric" value={num(c.taskId) ?? ''} onChange={(e) => set({ taskId: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} placeholder="42" />
              </Field>
            )}
          </>
        )}

        {widget.type === 'deadlines' && (
          <>
            {categoryField()}
            {labelField}
            <Field label="How many to show">
              <input className="input" type="number" min={1} max={30} value={num(c.limit) ?? 8} onChange={(e) => set({ limit: Math.max(1, Math.min(30, Number(e.target.value) || 8)) })} />
            </Field>
          </>
        )}

        {widget.type === 'breakdown' && (
          <>
            <Field label="Split by">
              <Select
                aria-label="Split by"
                value={str(c.by) || 'status'}
                onChange={(v) => set({ by: v })}
                options={[
                  { value: 'status', label: 'Status' },
                  { value: 'category', label: 'Category' },
                  { value: 'priority', label: 'Priority' },
                  { value: 'assignee', label: 'Assignee' },
                  { value: 'label', label: 'Label' },
                ]}
              />
            </Field>
            <div className="field">
              <span className="field-label">Show</span>
              <div className="segmented">
                {[
                  ['donut', 'Ring'],
                  ['bars', 'Bars'],
                ].map(([v, l]) => (
                  <button key={v} type="button" className={cx((str(c.chart) || 'donut') === v && 'active')} onClick={() => set({ chart: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">Which tasks</span>
              <div className="segmented">
                {[
                  ['open', 'Unfinished'],
                  ['all', 'All'],
                ].map(([v, l]) => (
                  <button key={v} type="button" className={cx((str(c.scope) || 'open') === v && 'active')} onClick={() => set({ scope: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {str(c.by) !== 'category' && categoryField()}
            {str(c.by) !== 'label' && labelField}
          </>
        )}

        {(widget.type === 'progress' || widget.type === 'timeline') && categoryField()}
        {(widget.type === 'timeline' || widget.type === 'stuck' || widget.type === 'workload') && labelField}

        {widget.type === 'stuck' && (
          <>
            {categoryField()}
            <Field label="Stuck after this many days without changes">
              <input className="input" type="number" min={1} max={90} value={num(c.days) ?? 7} onChange={(e) => set({ days: Math.max(1, Math.min(90, Number(e.target.value) || 7)) })} />
            </Field>
          </>
        )}

        {widget.type === 'note' && (
          <Field label="Text" hint="Plain text; an empty line starts a new paragraph">
            <AutoTextarea className="input" value={str(c.text)} maxLength={2000} onChange={(e) => set({ text: e.target.value })} placeholder="Release on Friday. Anything not in review by Thursday moves to the next one." />
          </Field>
        )}
      </div>
    </Modal>
  )
}
