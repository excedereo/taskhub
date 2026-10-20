import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical, LayoutDashboard, Pencil, Plus, Settings2, X } from 'lucide-react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import { cx } from '../util.ts'
import { ConfirmButton, Field, Modal, PageHeader } from '../components/ui.tsx'
import { Select } from '../components/Select.tsx'
import { AutoTextarea } from '../components/AutoTextarea.tsx'
import { useToast } from '../components/Toast.tsx'
import { moveItem } from '../components/useDragSort.ts'
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

  const widgets = draft ?? layout?.widgets
  return (
    <div className={cx('page dashboard', draft && 'is-editing')}>
      <PageHeader
        title="Analytics"
        description={draft ? 'Drag widgets by the handle, pick a size, open a widget’s settings. Everyone sees the result once you save.' : undefined}
        actions={
          draft ? (
            <>
              {layout?.custom && (
                <ConfirmButton className="btn-sm" confirmText="Back to default?" onConfirm={() => save(null)}>
                  Reset to default
                </ConfirmButton>
              )}
              <button className="btn btn-ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => save(draft)}>
                Save layout
              </button>
            </>
          ) : (
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

      {!widgets || !data ? (
        <div className="skeleton-list">
          <div className="skeleton-row" style={{ height: 96 }} />
          <div className="skeleton-row" style={{ height: 260 }} />
        </div>
      ) : (
        <Board widgets={widgets} data={data} days={days} onChange={draft ? setDraft : undefined} empty={can('manage_dashboard') ? ' Use Edit layout to add widgets.' : ''} />
      )}
    </div>
  )
}

let seq = 0
const newId = (type: WidgetType) => `${type}-${Date.now().toString(36)}-${++seq}`

/**
 * The dashboard grid. With onChange it becomes its own editor: every widget gets a small toolbar and
 * can be dragged around the grid by its handle, with the others making room as it passes over them.
 */
function Board({ widgets, data, days, onChange, empty }: { widgets: Widget[]; data: DashData; days: number; onChange?: (w: Widget[]) => void; empty: string }) {
  const editing = Boolean(onChange)
  const [adding, setAdding] = useState(false)
  const [settings, setSettings] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const refs = useRef(new Map<string, HTMLElement>())
  const latest = useRef({ widgets, onChange })
  latest.current = { widgets, onChange }
  const lastMove = useRef(0)

  const update = (id: string, patch: Partial<Widget>) => onChange?.(widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  const move = (from: number, to: number) => onChange?.(moveItem(widgets, from, Math.max(0, Math.min(widgets.length - 1, to))))

  useEffect(() => {
    if (!dragId) return
    const scroller = document.querySelector<HTMLElement>('.main')
    document.body.classList.add('is-dragging-widget')
    const onMove = (e: PointerEvent) => {
      // Near the top or bottom edge the page scrolls, so a widget can travel the whole dashboard.
      if (scroller) {
        if (e.clientY < 90) scroller.scrollBy(0, -14)
        else if (e.clientY > window.innerHeight - 90) scroller.scrollBy(0, 14)
      }
      if (Date.now() - lastMove.current < 140) return
      const { widgets: list, onChange: change } = latest.current
      const from = list.findIndex((w) => w.id === dragId)
      const self = refs.current.get(dragId)?.getBoundingClientRect()
      for (const [id, el] of refs.current) {
        if (id === dragId) continue
        const r = el.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue
        const to = list.findIndex((w) => w.id === id)
        // Only swap once the pointer is past the middle of the other widget, so neighbours do not flicker.
        const sameRow = self && Math.abs(self.top - r.top) < 8
        const ahead = sameRow ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2
        if ((to < from && ahead) || (to > from && !ahead)) {
          change?.(moveItem(list, from, to))
          lastMove.current = Date.now()
        }
        break
      }
    }
    const onUp = () => setDragId(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      document.body.classList.remove('is-dragging-widget')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragId])

  const editingWidget = settings ? widgets.find((w) => w.id === settings) : undefined

  return (
    <div className={cx('dash-board', editing && 'is-editing')}>
      {widgets.map((w, i) => {
        const Render = RENDERERS[w.type]
        return (
          <section
            key={w.id}
            ref={(el) => {
              if (el) refs.current.set(w.id, el)
              else refs.current.delete(w.id)
            }}
            className={cx('card dash-widget', `size-${w.size}`, `type-${w.type}`, dragId === w.id && 'is-dragging')}
          >
            {editing ? (
              <div className="dash-tools">
                <button
                  type="button"
                  className="grip"
                  aria-label={`Move ${titleOf(w)}`}
                  title="Drag to move (or focus and use the arrow keys)"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    setDragId(w.id)
                  }}
                  onKeyDown={(e) => {
                    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0
                    if (!step) return
                    e.preventDefault()
                    move(i, i + step)
                  }}
                >
                  <GripVertical size={14} />
                </button>
                <span className="dash-title truncate">{titleOf(w)}</span>
                <div className="segmented segmented-sm" aria-label="Size">
                  {SIZES.map(([size, label]) => (
                    <button key={size} type="button" className={cx(w.size === size && 'active')} onClick={() => update(w.id, { size })} title={size === 'full' ? 'Full width' : `${label} of the width`}>
                      {label}
                    </button>
                  ))}
                </div>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setSettings(w.id)} aria-label={`Settings of ${titleOf(w)}`} title="Settings">
                  <Settings2 size={14} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => onChange?.(widgets.filter((x) => x.id !== w.id))} aria-label={`Remove ${titleOf(w)}`} title="Remove">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <h2 className="dash-title">{titleOf(w)}</h2>
            )}
            <div className="dash-body">
              <Render widget={w} data={data} days={days} />
            </div>
          </section>
        )
      })}

      {editing ? (
        <button type="button" className="dash-add size-quarter" onClick={() => setAdding(true)}>
          <Plus size={18} />
          Add widget
        </button>
      ) : (
        widgets.length === 0 && (
          <div className="card dash-widget size-full">
            <p className="muted">The dashboard is empty.{empty}</p>
          </div>
        )
      )}

      {adding && (
        <Modal title="Add a widget" onClose={() => setAdding(false)} width={560}>
          <ul className="widget-picker">
            {(Object.keys(WIDGETS) as WidgetType[]).map((type) => (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => {
                    const w: Widget = { id: newId(type), type, size: WIDGETS[type].size, config: { ...WIDGETS[type].config } }
                    onChange?.([...widgets, w])
                    setAdding(false)
                    setSettings(w.id)
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

      {editingWidget && <WidgetSettings widget={editingWidget} onChange={(config) => update(editingWidget.id, { config })} onClose={() => setSettings(null)} />}
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
