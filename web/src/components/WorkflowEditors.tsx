import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { GripVertical, Star } from 'lucide-react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import type { StatusType } from '../types.ts'
import { cx } from '../util.ts'
import { ConfirmButton, PriorityIcon, StatusIcon } from './ui.tsx'
import { Select } from './Select.tsx'
import { moveItem, useDragSort } from './useDragSort.ts'
import { useToast } from './Toast.tsx'

const WORKFLOW_COLORS = ['#dc2626', '#ea580c', '#eab308', '#16a34a', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#a1a1aa']

export { WORKFLOW_COLORS }

export const TYPE_OPTIONS: { value: StatusType; label: string }[] = [
  { value: 'todo', label: 'Not started' },
  { value: 'active', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

const DEFAULT_ICON: Record<StatusType, string> = { todo: 'circle-dashed', active: 'loader', done: 'circle-check' }

/** Shared plumbing: run a request, then reload; on failure show it and reload anyway so the list is truthful. */
function useRunner(reload: () => Promise<void>) {
  const toast = useToast()
  return async (action: () => Promise<unknown>) => {
    try {
      await action()
      await reload()
      return true
    } catch (err) {
      toast.error(err)
      await reload().catch(() => {})
      return false
    }
  }
}

/** A sortable list whose order moves on screen immediately, while the server catches up. */
export function useOptimisticOrder<T extends { id: number }>(items: T[], save: (ids: number[]) => Promise<unknown>) {
  const [order, setOrder] = useState(items)
  useEffect(() => setOrder(items), [items])
  const sort = useDragSort(order.length, (from, to) => {
    const next = moveItem(order, from, to)
    setOrder(next)
    save(next.map((x) => x.id))
  })
  return { order, sort }
}

function EditorCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="card form workflow-card">
      <div className="stack">
        <span>{title}</span>
        <span className="muted small">{hint}</span>
      </div>
      {children}
    </section>
  )
}

export function StatusesEditor() {
  const { statuses, reloadStatuses } = useData()
  const run = useRunner(reloadStatuses)
  const [name, setName] = useState('')
  const [type, setType] = useState<StatusType>('active')
  const { order, sort } = useOptimisticOrder(statuses, (ids) => run(() => api.put('/statuses/order', { ids })))
  const lastOfType = (t: StatusType) => statuses.filter((s) => s.type === t).length === 1

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    run(() => api.post('/statuses', { name: name.trim(), type, icon: DEFAULT_ICON[type], color: WORKFLOW_COLORS[statuses.length % WORKFLOW_COLORS.length] })).then((ok) => ok && setName(''))
  }

  return (
    <EditorCard title="Statuses" hint="The steps a task goes through. The type decides what a status means: Take moves to the first “In progress”, “Done” closes the task and moves it to Finished. Colors and icons are set by each person in their own Settings.">
      <ul className="workflow-list">
        {order.map((s, i) => (
          <li key={s.id} ref={sort.ref(i)} style={sort.style(i)} className={cx(sort.dragging === i && 'is-dragging')}>
            <button type="button" className="grip" aria-label={`Drag ${s.name}`} title="Drag to reorder" {...sort.handle(i)}>
              <GripVertical size={14} />
            </button>
            <span className="workflow-preview"><StatusIcon id={s.id} size={16} /></span>
            <input
              className="input input-inline"
              defaultValue={s.name}
              maxLength={24}
              aria-label="Status name"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && run(() => api.patch(`/statuses/${s.id}`, { name: e.target.value.trim() }))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <Select variant="sm" aria-label="Type" value={s.type} disabled={lastOfType(s.type)} onChange={(t) => run(() => api.patch(`/statuses/${s.id}`, { type: t }))} options={TYPE_OPTIONS} />
            {lastOfType(s.type) ? (
              <span className="workflow-lock" title="The only status of its type cannot be removed" />
            ) : (
              <ConfirmButton className="btn-sm" confirmText={s.taskCount ? `Move ${s.taskCount} task(s)?` : 'Delete?'} onConfirm={() => run(() => api.del(`/statuses/${s.id}`))}>
                Delete
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
      <form className="row gap-xs" onSubmit={add}>
        <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="New status, e.g. Testing" />
        <Select variant="sm" aria-label="Type of the new status" value={type} onChange={setType} options={TYPE_OPTIONS} />
        <button className="btn" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </EditorCard>
  )
}

export function PrioritiesEditor() {
  const { priorities, reloadPriorities } = useData()
  const run = useRunner(reloadPriorities)
  const [name, setName] = useState('')
  const { order, sort } = useOptimisticOrder(priorities, (ids) => run(() => api.put('/priorities/order', { ids })))

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    run(() => api.post('/priorities', { name: name.trim(), color: WORKFLOW_COLORS[priorities.length % WORKFLOW_COLORS.length] })).then((ok) => ok && setName(''))
  }

  return (
    <EditorCard title="Priorities" hint="Most important at the top. The star marks the priority new tasks get. Colors and icons are set by each person in their own Settings.">
      <ul className="workflow-list">
        {order.map((p, i) => (
          <li key={p.id} ref={sort.ref(i)} style={sort.style(i)} className={cx(sort.dragging === i && 'is-dragging')}>
            <button type="button" className="grip" aria-label={`Drag ${p.name}`} title="Drag to reorder" {...sort.handle(i)}>
              <GripVertical size={14} />
            </button>
            <span className="workflow-preview"><PriorityIcon id={p.id} /></span>
            <input
              className="input input-inline"
              defaultValue={p.name}
              maxLength={24}
              aria-label="Priority name"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && run(() => api.patch(`/priorities/${p.id}`, { name: e.target.value.trim() }))}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <button
              type="button"
              className={cx('icon-btn icon-btn-sm', p.isDefault && 'star-on')}
              onClick={() => !p.isDefault && run(() => api.patch(`/priorities/${p.id}`, { isDefault: true }))}
              aria-label={p.isDefault ? 'Default priority' : 'Make default'}
              title={p.isDefault ? 'New tasks get this priority' : 'Make default'}
            >
              <Star size={14} fill={p.isDefault ? 'currentColor' : 'none'} />
            </button>
            {p.isDefault ? (
              <span className="workflow-lock" />
            ) : (
              <ConfirmButton className="btn-sm" confirmText={p.taskCount ? `Move ${p.taskCount} to default?` : 'Delete?'} onConfirm={() => run(() => api.del(`/priorities/${p.id}`))}>
                Delete
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
      <form className="row gap-xs" onSubmit={add}>
        <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="New priority, e.g. Critical" />
        <button className="btn" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </EditorCard>
  )
}
