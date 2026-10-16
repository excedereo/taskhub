import { useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import { PRIORITIES, type Priority, type Task } from '../types.ts'
import { displayName } from '../util.ts'
import { Field, Modal } from './ui.tsx'
import { useToast } from './Toast.tsx'

export function NewTaskModal({ defaultCategoryId, onClose, onCreated }: { defaultCategoryId?: number; onClose: () => void; onCreated: (task: Task) => void }) {
  const me = useMe()
  const { categories, users, can, reloadCategories } = useData()
  const toast = useToast()
  const active = categories.filter((c) => !c.archived)

  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? active[0]?.id ?? 0)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const canAssign = can('assign_tasks')
  const canTake = can('take_tasks')
  const assignable = canAssign ? users.filter((u) => u.status !== 'disabled') : users.filter((u) => u.id === me.id)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const task = await api.post<Task>('/tasks', { categoryId, title, description, priority, assigneeId })
      reloadCategories()
      onCreated(task)
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New task"
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="task-form" className="btn btn-primary" disabled={busy || !title.trim() || !categoryId}>
            Create task
          </button>
        </>
      }
    >
      <form id="task-form" className="form" onSubmit={submit}>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" maxLength={200} autoFocus />
        </Field>
        <Field label="Description">
          <textarea className="input" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Steps to reproduce, context, links…" />
        </Field>
        <div className="form-row">
          <Field label="Category">
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          {(canAssign || canTake) && (
            <Field label="Assignee">
              <select className="input" value={assigneeId ?? ''} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Unassigned</option>
                {assignable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id === me.id ? `${displayName(u)} (me)` : displayName(u)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </form>
    </Modal>
  )
}
