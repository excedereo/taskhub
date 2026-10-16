import { useState, type FormEvent } from 'react'
import { GripVertical, Star } from 'lucide-react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import type { Priority } from '../types.ts'
import { cx } from '../util.ts'
import { ConfirmButton, Modal, PriorityIcon } from './ui.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { moveItem, useDragSort } from './useDragSort.ts'
import { useToast } from './Toast.tsx'

const PRIORITY_COLORS = ['#dc2626', '#ea580c', '#eab308', '#16a34a', '#0090ff', '#6e56cf', '#d6409f', '#a1a1aa']

/** Workspace priorities: most important at the top. Every change is saved right away. */
export function PrioritiesModal({ onClose }: { onClose: () => void }) {
  const { priorities, reloadPriorities } = useData()
  const toast = useToast()
  const [name, setName] = useState('')
  const sort = useDragSort(priorities.length, (from, to) => {
    run(() => api.put('/priorities/order', { ids: moveItem(priorities, from, to).map((p) => p.id) }))
  })

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      await reloadPriorities()
    } catch (err) {
      toast.error(err)
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    run(() => api.post<Priority[]>('/priorities', { name: name.trim(), color: PRIORITY_COLORS[priorities.length % PRIORITY_COLORS.length] })).then(() => setName(''))
  }

  return (
    <Modal title="Priorities" width={560} onClose={onClose}>
      <p className="muted small priorities-hint">Most important at the top. Drag to reorder; the star marks the priority new tasks get.</p>
      <ul className="priority-admin">
        {priorities.map((p, i) => (
          <li key={p.id} ref={sort.ref(i)} style={sort.style(i)} className={cx(sort.dragging === i && 'is-dragging')}>
            <button type="button" className="grip" aria-label={`Drag ${p.name}`} title="Drag to reorder" {...sort.handle(i)}>
              <GripVertical size={14} />
            </button>
            <PriorityIcon id={p.id} />
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
              <span className="priority-del-placeholder" />
            ) : (
              <ConfirmButton className="btn-sm" confirmText={p.taskCount ? `Move ${p.taskCount} to default?` : 'Delete?'} onConfirm={() => run(() => api.del(`/priorities/${p.id}`))}>
                Delete
              </ConfirmButton>
            )}
            <div className="priority-colors">
              <ColorPicker small value={p.color} presets={PRIORITY_COLORS} onChange={(color) => color && run(() => api.patch(`/priorities/${p.id}`, { color }))} />
            </div>
          </li>
        ))}
      </ul>
      <form className="row gap-xs priorities-add" onSubmit={add}>
        <input className="input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="New priority, e.g. Critical" />
        <button className="btn" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </Modal>
  )
}
