import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Archive, ArchiveRestore, Hash, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { api, imageFiles, uploadImage } from '../api.ts'
import { useData, useMe, useSession } from '../store.tsx'
import { PRIORITIES, STATUSES, type Attachment, type AuditEvent, type Task } from '../types.ts'
import { cx, displayName, formatDate, timeAgo } from '../util.ts'
import { Avatar, ConfirmButton, PriorityIcon, StatusIcon, UserChip } from './ui.tsx'
import { Select } from './Select.tsx'
import { AutoTextarea } from './AutoTextarea.tsx'
import { Gallery, type GalleryItem } from './Gallery.tsx'
import { describeEvent } from './describeEvent.tsx'
import { useToast } from './Toast.tsx'

type Props = {
  taskId: number
  onClose: () => void
  onOpenTask: (id: number) => void
  onChanged: (task: Task) => void
  onDeleted: (id: number) => void
}

type TaskDetails = { task: Task; history: AuditEvent[]; attachments: Attachment[]; subtasks: Task[]; parent: { id: number; title: string } | null }
type Pending = { key: string; url: string; name: string; width: number | null; height: number | null }

let pendingSeq = 0

export function TaskPanel({ taskId, onClose, onOpenTask, onChanged, onDeleted }: Props) {
  const me = useMe()
  const { meta } = useSession()
  const { users, userById, roleById, categoryById, categories, can, reloadCategories } = useData()
  const toast = useToast()
  const [task, setTask] = useState<Task | null>(null)
  const [history, setHistory] = useState<AuditEvent[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [subtasks, setSubtasks] = useState<Task[]>([])
  const [parent, setParent] = useState<TaskDetails['parent']>(null)
  const [newSubtask, setNewSubtask] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dragging, setDragging] = useState(false)

  // The parent passes fresh closures every render; reading them through refs keeps the callbacks stable.
  const closeRef = useRef(onClose)
  const changedRef = useRef(onChanged)
  useEffect(() => {
    closeRef.current = onClose
    changedRef.current = onChanged
  })

  const load = useCallback(async () => {
    try {
      const res = await api.get<TaskDetails>(`/tasks/${taskId}`)
      setTask(res.task)
      setHistory(res.history)
      setAttachments(res.attachments)
      setSubtasks(res.subtasks)
      setParent(res.parent)
      setTitle(res.task.title)
      setDescription(res.task.description)
    } catch (err) {
      toast.error(err)
      closeRef.current()
    }
  }, [taskId, toast])

  /** Re-reads server state without touching fields the user may be typing in. */
  const refresh = useCallback(async () => {
    const res = await api.get<TaskDetails>(`/tasks/${taskId}`)
    setTask(res.task)
    setHistory(res.history)
    setAttachments(res.attachments)
    setSubtasks(res.subtasks)
    changedRef.current(res.task)
    res.subtasks.forEach((s) => changedRef.current(s))
  }, [taskId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isCreator = task?.creatorId === me.id
  const isAssignee = task?.assigneeId === me.id
  const canEdit = can('edit_tasks') || isCreator
  const canWork = canEdit || isAssignee

  const upload = useCallback(
    async (files: File[]) => {
      const queued = files.map((file) => ({ file, key: `p${++pendingSeq}`, url: URL.createObjectURL(file) }))
      setPending((p) => [...p, ...queued.map(({ key, url, file }) => ({ key, url, name: file.name, width: null, height: null }))])
      await Promise.all(
        queued.map(async ({ file, key, url }) => {
          try {
            await uploadImage<Attachment>(taskId, file)
          } catch (err) {
            toast.error(err)
          } finally {
            setPending((p) => p.filter((x) => x.key !== key))
            URL.revokeObjectURL(url)
          }
        }),
      )
      await refresh().catch(toast.error)
    },
    [taskId, refresh, toast],
  )

  // Paste screenshots straight into the open task.
  useEffect(() => {
    if (!canWork) return
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData?.items)
      if (!files.length) return
      e.preventDefault()
      upload(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [canWork, upload])

  if (!task) {
    return (
      <div className="panel-backdrop" onMouseDown={onClose}>
        <aside className="panel" onMouseDown={(e) => e.stopPropagation()} />
      </div>
    )
  }

  const canAssign = can('assign_tasks')
  const canTake = (can('take_tasks') || canAssign) && task.assigneeId === null && task.status !== 'done'

  async function mutate(request: () => Promise<unknown>) {
    try {
      await request()
      reloadCategories()
      await refresh()
      return true
    } catch (err) {
      toast.error(err)
      load()
      return false
    }
  }

  const patch = (body: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'categoryId'>>) => mutate(() => api.patch(`/tasks/${task.id}`, body))
  const assign = (userId: number | null) => mutate(() => api.post(`/tasks/${task.id}/assign`, { userId }))
  const take = () => mutate(() => api.post(`/tasks/${task.id}/take`))
  const removeImage = (item: GalleryItem) => mutate(() => api.del(`/attachments/${item.key.slice(1)}`))
  const setArchived = (archived: boolean) =>
    mutate(() => api.post(`/tasks/${task.id}/archive`, { archived })).then((ok) => ok && toast.info(archived ? 'Task archived' : 'Task restored'))
  const toggleSubtask =(s: Task) => mutate(() => api.patch(`/tasks/${s.id}`, { status: s.status === 'done' ? 'open' : 'done' }))
  const addSubtask = () => {
    const value = newSubtask.trim()
    if (!value) return
    setNewSubtask('')
    mutate(() => api.post(`/tasks`, { parentId: task.id, title: value }))
  }

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

  const hasFiles = (e: DragEvent) => canWork && Array.from(e.dataTransfer.types).includes('Files')
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragging(false)
      const files = imageFiles(e.dataTransfer.files)
      if (files.length) upload(files)
      else toast.info('Only images can be attached')
    },
  }

  const gallery: GalleryItem[] = [
    ...attachments.map((a) => ({
      key: `a${a.id}`,
      src: a.url,
      name: a.name,
      width: a.width,
      height: a.height,
      size: a.size,
      meta: <>added by {displayName(a.uploaderId ? userById.get(a.uploaderId) : null)} {timeAgo(a.createdAt)}</>,
      removable: a.uploaderId === me.id || canEdit,
      downloadUrl: `${a.url}?download=1`,
    })),
    ...pending.map((p) => ({ ...p, src: p.url, pending: true })),
  ]

  const ctx = { userById, roleById, categoryById, permissions: meta?.permissions ?? [] }
  const category = categoryById.get(task.categoryId)
  const assigneeOptions = [
    { value: null, label: 'Unassigned', icon: <span className="avatar avatar-empty" style={{ width: 18, height: 18 }} /> },
    ...users
      .filter((u) => u.status !== 'disabled' || u.id === task.assigneeId)
      .map((u) => ({ value: u.id, label: u.id === me.id ? `${displayName(u)} (me)` : displayName(u), icon: <Avatar user={u} size={18} /> })),
  ]

  return (
    <div className="panel-backdrop" onMouseDown={onClose}>
      <aside className="panel" onMouseDown={(e) => e.stopPropagation()} aria-label={`Task #${task.id}`} {...dropProps}>
        <div className="panel-head">
          <span className="muted small truncate">
            #{task.id} · {category?.name ?? 'Unknown category'}
            {parent && (
              <>
                {' · subtask of '}
                <button className="link-btn" onClick={() => onOpenTask(parent.id)}>
                  #{parent.id} {parent.title}
                </button>
              </>
            )}
          </span>
          <div className="row gap-xs">
            {canEdit && !task.archivedAt && (
              <button className="btn btn-sm btn-ghost" onClick={() => setArchived(true)} title="Hide from lists and analytics. You can restore it later.">
                <Archive size={14} /> Archive
              </button>
            )}
            {can('delete_tasks') && (
              <ConfirmButton className="btn-sm" confirmText={task.subtaskCount ? `Delete with ${task.subtaskCount} subtask(s)?` : 'Delete task?'} onConfirm={remove}>
                <Trash2 size={14} /> Delete
              </ConfirmButton>
            )}
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="panel-body">
          {task.archivedAt && (
            <div className="notice archived-notice">
              <Archive size={14} />
              <span className="grow">Archived {timeAgo(task.archivedAt)}. It is hidden from task lists and analytics.</span>
              {canEdit && (
                <button className="btn btn-sm" onClick={() => setArchived(false)}>
                  <ArchiveRestore size={14} /> Restore
                </button>
              )}
            </div>
          )}
          {canEdit ? (
            <AutoTextarea
              className="title-input"
              minRows={1}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onBlur={() => (title.trim() && title !== task.title ? patch({ title }) : setTitle(task.title))}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            />
          ) : (
            <h2 className="title-static">{task.title}</h2>
          )}

          <dl className="props">
            <dt>Status</dt>
            <dd>
              <Select
                variant="ghost"
                aria-label="Status"
                value={task.status}
                disabled={!canWork}
                onChange={(status) => patch({ status })}
                options={STATUSES.map((s) => ({ value: s.key, label: s.label, icon: <StatusIcon status={s.key} /> }))}
              />
            </dd>

            <dt>Priority</dt>
            <dd>
              <Select
                variant="ghost"
                aria-label="Priority"
                value={task.priority}
                disabled={!canEdit}
                onChange={(priority) => patch({ priority })}
                options={PRIORITIES.map((p) => ({ value: p.key, label: p.label, icon: <PriorityIcon priority={p.key} /> }))}
              />
            </dd>

            <dt>Assignee</dt>
            <dd className="row gap-xs wrap">
              {canAssign ? (
                <Select variant="ghost" aria-label="Assignee" value={task.assigneeId} onChange={assign} options={assigneeOptions} />
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
              <Select
                variant="ghost"
                aria-label="Category"
                value={task.categoryId}
                disabled={!canEdit || Boolean(task.parentId)}
                onChange={(categoryId) => patch({ categoryId })}
                options={categories
                  .filter((c) => !c.archived || c.id === task.categoryId)
                  .map((c) => ({ value: c.id, label: c.name, icon: <Hash size={14} className="muted" /> }))}
              />
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
              <AutoTextarea
                className="input description-input"
                minRows={4}
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

          {!task.parentId && (subtasks.length > 0 || can('create_tasks')) && (
            <section className="panel-section">
              <h3>
                Subtasks{' '}
                {subtasks.length > 0 && (
                  <span className="muted">
                    {subtasks.filter((s) => s.status === 'done').length}/{subtasks.length}
                  </span>
                )}
              </h3>
              {subtasks.length > 0 && (
                <div className="progress" aria-hidden>
                  <span style={{ width: `${(subtasks.filter((s) => s.status === 'done').length / subtasks.length) * 100}%` }} />
                </div>
              )}
              <ul className="subtasks">
                {subtasks.map((s) => (
                  <li key={s.id} className={cx('subtask', s.status === 'done' && 'task-row-done')}>
                    <button className="subtask-check" onClick={() => toggleSubtask(s)} title={s.status === 'done' ? 'Mark as open' : 'Mark as done'} aria-label={s.status === 'done' ? 'Mark as open' : 'Mark as done'}>
                      <StatusIcon status={s.status} size={16} />
                    </button>
                    <button className="subtask-title" onClick={() => onOpenTask(s.id)}>
                      <span className="truncate">{s.title}</span>
                    </button>
                    <span className="muted small">#{s.id}</span>
                    {s.assigneeId ? <Avatar user={userById.get(s.assigneeId)} size={20} /> : <span className="avatar avatar-empty" style={{ width: 20, height: 20 }} />}
                  </li>
                ))}
              </ul>
              {can('create_tasks') && (
                <form
                  className="subtask-add"
                  onSubmit={(e) => {
                    e.preventDefault()
                    addSubtask()
                  }}
                >
                  <Plus size={14} className="muted" />
                  <input value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add a subtask and press Enter" maxLength={200} />
                </form>
              )}
            </section>
          )}

          {(gallery.length > 0 || canWork) && (
            <section className="panel-section">
              <h3>
                Images {gallery.length > 0 && <span className="muted">{gallery.length}</span>}
              </h3>
              <Gallery items={gallery} onRemove={removeImage} onAdd={canWork ? upload : undefined} />
              {canWork && <p className="muted small gallery-hint">Paste a screenshot with Ctrl+V or drop images anywhere on this panel.</p>}
            </section>
          )}

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

        {dragging && (
          <div className="drop-overlay">
            <ImagePlus size={28} />
            <span>Drop images to attach</span>
          </div>
        )}
      </aside>
    </div>
  )
}
