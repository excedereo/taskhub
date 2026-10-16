import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe, useSession } from '../store.tsx'
import { PRIORITIES, STATUSES, type AuditEvent, type Priority, type Status, type Task } from '../types.ts'
import { displayName, formatDate, timeAgo } from '../util.ts'
import { Avatar, ConfirmButton, PriorityIcon, StatusIcon, UserChip } from './ui.tsx'
import { describeEvent } from './describeEvent.tsx'
import { useToast } from './Toast.tsx'

type Props = {
  taskId: number
  onClose: () => void
  onChanged: (task: Task) => void
  onDeleted: (id: number) => void
}

export function TaskPanel({ taskId, onClose, onChanged, onDeleted }: Props) {
  const me = useMe()
  const { meta } = useSession()
  const { users, userById, roleById, categoryById, categories, can, reloadCategories } = useData()
  const toast = useToast()
  const [task, setTask] = useState<Task | null>(null)
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // The parent passes a fresh closure every render; reading it through a ref keeps `load` stable.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ task: Task; history: AuditEvent[] }>(`/tasks/${taskId}`)
      setTask(res.task)
      setHistory(res.history)
      setTitle(res.task.title)
      setDescription(res.task.description)
    } catch (err) {
      toast.error(err)
      closeRef.current()
    }
  }, [taskId, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!task) {
    return (
      <div className="panel-backdrop" onMouseDown={onClose}>
        <aside className="panel" onMouseDown={(e) => e.stopPropagation()} />
      </div>
    )
  }

  const isCreator = task.creatorId === me.id
  const isAssignee = task.assigneeId === me.id
  const canEdit = can('edit_tasks') || isCreator
  const canStatus = canEdit || isAssignee
  const canAssign = can('assign_tasks')
  const canTake = (can('take_tasks') || canAssign) && task.assigneeId === null && task.status !== 'done'

  async function mutate(request: () => Promise<Task>) {
    try {
      const updated = await request()
      setTask(updated)
      onChanged(updated)
      reloadCategories()
      const res = await api.get<{ history: AuditEvent[] }>(`/tasks/${taskId}`)
      setHistory(res.history)
    } catch (err) {
      toast.error(err)
      load()
    }
  }

  const patch = (body: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'categoryId'>>) =>
    mutate(() => api.patch<Task>(`/tasks/${task.id}`, body))
  const assign = (userId: number | null) => mutate(() => api.post<Task>(`/tasks/${task.id}/assign`, { userId }))
  const take = () => mutate(() => api.post<Task>(`/tasks/${task.id}/take`))

  const remove = async () => {
    try {
      await api.del(`/tasks/${task.id}`)
      reloadCategories()
      onDeleted(task.id)
      onClose()
    } catch (err) {
      toast.error(err)
    }
  }

  const ctx = { userById, roleById, categoryById, permissions: meta?.permissions ?? [] }
  const category = categoryById.get(task.categoryId)

  return (
    <div className="panel-backdrop" onMouseDown={onClose}>
      <aside className="panel" onMouseDown={(e) => e.stopPropagation()} aria-label={`Task #${task.id}`}>
        <div className="panel-head">
          <span className="muted small">
            #{task.id} · {category?.name ?? 'Unknown category'}
          </span>
          <div className="row gap-xs">
            {can('delete_tasks') && (
              <ConfirmButton className="btn-sm" confirmText="Delete task?" onConfirm={remove}>
                <Trash2 size={14} /> Delete
              </ConfirmButton>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="panel-body">
          {canEdit ? (
            <textarea
              className="title-input"
              rows={1}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onBlur={() => title.trim() && title !== task.title ? patch({ title }) : setTitle(task.title)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            />
          ) : (
            <h2 className="title-static">{task.title}</h2>
          )}

          <dl className="props">
            <dt>Status</dt>
            <dd>
              <span className="select-with-icon">
                <StatusIcon status={task.status} />
                <select className="input input-ghost" value={task.status} disabled={!canStatus} onChange={(e) => patch({ status: e.target.value as Status })}>
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </span>
            </dd>

            <dt>Priority</dt>
            <dd>
              <span className="select-with-icon">
                <PriorityIcon priority={task.priority} />
                <select className="input input-ghost" value={task.priority} disabled={!canEdit} onChange={(e) => patch({ priority: e.target.value as Priority })}>
                  {PRIORITIES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </span>
            </dd>

            <dt>Assignee</dt>
            <dd className="row gap-xs wrap">
              {canAssign ? (
                <span className="select-with-icon">
                  <Avatar user={task.assigneeId ? userById.get(task.assigneeId) : null} size={18} />
                  <select className="input input-ghost" value={task.assigneeId ?? ''} onChange={(e) => assign(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Unassigned</option>
                    {users
                      .filter((u) => u.status !== 'disabled' || u.id === task.assigneeId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {displayName(u)}
                          {u.id === me.id ? ' (me)' : ''}
                        </option>
                      ))}
                  </select>
                </span>
              ) : task.assigneeId ? (
                <UserChip user={userById.get(task.assigneeId)} />
              ) : (
                <span className="muted">Unassigned</span>
              )}
              {canTake && (
                <button className="btn btn-sm" onClick={take}>
                  Take
                </button>
              )}
              {isAssignee && !canAssign && (
                <button className="btn btn-sm btn-ghost" onClick={() => assign(null)}>
                  Drop
                </button>
              )}
            </dd>

            <dt>Category</dt>
            <dd>
              <select className="input input-ghost" value={task.categoryId} disabled={!canEdit} onChange={(e) => patch({ categoryId: Number(e.target.value) })}>
                {categories
                  .filter((c) => !c.archived || c.id === task.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </dd>

            <dt>Created by</dt>
            <dd>
              <UserChip user={task.creatorId ? userById.get(task.creatorId) : null} />
            </dd>

            <dt>Created</dt>
            <dd title={formatDate(task.createdAt)}>{timeAgo(task.createdAt)}</dd>

            {task.closedAt && (
              <>
                <dt>Closed</dt>
                <dd title={formatDate(task.closedAt)}>{timeAgo(task.closedAt)}</dd>
              </>
            )}
          </dl>

          <section className="panel-section">
            <h3>Description</h3>
            {canEdit ? (
              <textarea
                className="input description-input"
                rows={Math.min(16, Math.max(4, description.split('\n').length + 1))}
                value={description}
                placeholder="Add a description…"
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== task.description && patch({ description })}
              />
            ) : task.description ? (
              <p className="description">{task.description}</p>
            ) : (
              <p className="muted">No description</p>
            )}
          </section>

          <section className="panel-section">
            <h3>Activity</h3>
            <ol className="timeline">
              {history.map((e) => (
                <li key={e.id}>
                  <Avatar user={e.actorId ? userById.get(e.actorId) : null} size={20} />
                  <span>
                    <strong>{displayName(e.actorId ? userById.get(e.actorId) : null)}</strong> {describeEvent(e, ctx, true)}
                    <span className="muted small" title={formatDate(e.createdAt)}>
                      {' '}
                      · {timeAgo(e.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </div>
  )
}
