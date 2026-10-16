import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Archive, Hash, Layers, Pencil, Plus, Search } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import { STATUSES, type Status, type Task } from '../types.ts'
import { cx, displayName, formatDate, timeAgo } from '../util.ts'
import { Avatar, Empty, PageHeader, PriorityIcon, StatusIcon } from '../components/ui.tsx'
import { TaskPanel } from '../components/TaskPanel.tsx'
import { NewTaskModal } from '../components/NewTaskModal.tsx'
import { CategoryModal } from '../components/CategoryModal.tsx'
import { useToast } from '../components/Toast.tsx'

type StatusFilter = 'active' | 'all' | Status

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  ...STATUSES,
  { key: 'all', label: 'All' },
]

// Order of groups on screen: what is being worked on comes first.
const GROUP_ORDER: Status[] = ['in_progress', 'review', 'open', 'done']

export function TasksPage() {
  const me = useMe()
  const { categoryId: categoryParam } = useParams()
  const [params, setParams] = useSearchParams()
  const { categories, categoryById, users, userById, can, reloadCategories } = useData()
  const toast = useToast()

  const categoryId = categoryParam ? Number(categoryParam) : null
  const category = categoryId ? categoryById.get(categoryId) : undefined
  const assignee = params.get('assignee') ?? ''
  const statusFilter = (params.get('status') ?? 'active') as StatusFilter
  const openTaskId = params.get('task') ? Number(params.get('task')) : null

  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingCategory, setEditingCategory] = useState(false)

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setParams((p) => {
        const next = new URLSearchParams(p)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        return next
      })
    },
    [setParams],
  )

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams()
    if (categoryId) qs.set('categoryId', String(categoryId))
    if (assignee) qs.set('assignee', assignee)
    if (query.trim()) qs.set('q', query.trim())
    setTasks(null)
    const t = setTimeout(() => {
      api.get<Task[]>(`/tasks?${qs}`).then((r) => !cancelled && setTasks(r)).catch(toast.error)
    }, query ? 200 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [categoryId, assignee, query, toast])

  const visible = useMemo(() => {
    if (!tasks) return []
    if (statusFilter === 'all') return tasks
    if (statusFilter === 'active') return tasks.filter((t) => t.status !== 'done')
    return tasks.filter((t) => t.status === statusFilter)
  }, [tasks, statusFilter])

  const groups = GROUP_ORDER.map((status) => ({ status, items: visible.filter((t) => t.status === status) })).filter((g) => g.items.length)

  const upsert = (task: Task) =>
    setTasks((list) => {
      if (!list) return list
      const fits = (!categoryId || task.categoryId === categoryId) && (assignee !== 'me' || task.assigneeId === me.id)
      const without = list.filter((t) => t.id !== task.id)
      return fits ? [task, ...without].sort((a, b) => GROUP_ORDER.indexOf(a.status) - GROUP_ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt) : without
    })

  const take = async (task: Task) => {
    try {
      upsert(await api.post<Task>(`/tasks/${task.id}/take`))
      reloadCategories()
    } catch (err) {
      toast.error(err)
    }
  }

  const title = category ? category.name : assignee === 'me' ? 'My tasks' : 'All tasks'
  const hasCategories = categories.some((c) => !c.archived)
  const canCreate = can('create_tasks') && hasCategories && !category?.archived
  const canTake = can('take_tasks') || can('assign_tasks')

  if (categoryId && categories.length && !category) {
    return (
      <div className="page">
        <Empty icon={<Hash size={20} />} title="Category not found">
          It may have been deleted.
        </Empty>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={
          <span className="row gap-sm">
            {title}
            {category?.archived && (
              <span className="badge">
                <Archive size={12} /> Archived
              </span>
            )}
          </span>
        }
        description={category?.description || (assignee === 'me' ? 'Tasks assigned to you' : !category ? 'Every task across all categories' : undefined)}
        actions={
          <>
            {category && can('manage_categories') && (
              <button className="btn btn-ghost" onClick={() => setEditingCategory(true)}>
                <Pencil size={14} /> Edit
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> New task
              </button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Status filter">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={statusFilter === f.key} className={cx(statusFilter === f.key && 'active')} onClick={() => setParam('status', f.key === 'active' ? null : f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or #id" aria-label="Search tasks" />
          </label>
          <select className="input input-sm" value={assignee} onChange={(e) => setParam('assignee', e.target.value)} aria-label="Assignee filter">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {users
              .filter((u) => u.id !== me.id && u.status !== 'invited')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                </option>
              ))}
          </select>
        </div>
      </div>

      {tasks === null ? (
        <div className="skeleton-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      ) : !hasCategories ? (
        <Empty icon={<Layers size={20} />} title="No categories yet">
          {can('manage_categories') ? 'Create one with the + next to Categories in the sidebar, for example "Bug reports".' : 'Ask someone who manages categories to create the first one.'}
        </Empty>
      ) : groups.length === 0 ? (
        <Empty icon={<Layers size={20} />} title={query ? 'Nothing matches your search' : 'No tasks here'}>
          {canCreate && !query && (
            <button className="btn" onClick={() => setCreating(true)}>
              <Plus size={14} /> New task
            </button>
          )}
        </Empty>
      ) : (
        <div className="task-groups">
          {groups.map((g) => (
            <section key={g.status} className="task-group">
              <h2 className="group-head">
                <StatusIcon status={g.status} />
                {STATUSES.find((s) => s.key === g.status)?.label}
                <span className="muted">{g.items.length}</span>
              </h2>
              <ul className="task-list">
                {g.items.map((t) => {
                  const assigneeUser = t.assigneeId ? userById.get(t.assigneeId) : null
                  return (
                    <li key={t.id}>
                      <div role="button" tabIndex={0} className={cx('task-row', openTaskId === t.id && 'selected')} onClick={() => setParam('task', String(t.id))} onKeyDown={(e) => e.key === 'Enter' && setParam('task', String(t.id))}>
                        <PriorityIcon priority={t.priority} />
                        <span className="task-id">#{t.id}</span>
                        <StatusIcon status={t.status} />
                        <span className="task-title truncate">{t.title}</span>
                        {!category && <span className="badge task-category">{categoryById.get(t.categoryId)?.name}</span>}
                        <span className="task-time muted small" title={formatDate(t.updatedAt)}>
                          {timeAgo(t.updatedAt)}
                        </span>
                        <span className="task-assignee">
                          {assigneeUser ? (
                            <Avatar user={assigneeUser} size={22} />
                          ) : canTake && t.status !== 'done' ? (
                            <button className="btn btn-sm btn-ghost take-btn" onClick={(e) => (e.stopPropagation(), take(t))}>
                              Take
                            </button>
                          ) : (
                            <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} title="Unassigned" />
                          )}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {openTaskId && (
        <TaskPanel
          key={openTaskId}
          taskId={openTaskId}
          onClose={() => setParam('task', null)}
          onChanged={upsert}
          onDeleted={(id) => setTasks((list) => list?.filter((t) => t.id !== id) ?? list)}
        />
      )}
      {creating && <NewTaskModal defaultCategoryId={category && !category.archived ? category.id : undefined} onClose={() => setCreating(false)} onCreated={(t) => (upsert(t), setParam('task', String(t.id)))} />}
      {editingCategory && category && <CategoryModal category={category} onClose={() => setEditingCategory(false)} />}
    </div>
  )
}
