import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Archive, ArrowUpDown, Hash, Layers, Pencil, Plus, Search, Users } from 'lucide-react'
import { Select } from '../components/Select.tsx'
import { api } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import { STATUSES, type Section, type Status, type Task } from '../types.ts'
import { cx, displayName } from '../util.ts'
import { Avatar, Empty, PageHeader, StatusIcon } from '../components/ui.tsx'
import { TaskPanel } from '../components/TaskPanel.tsx'
import { TaskRow } from '../components/TaskRow.tsx'
import { ArrangeList, CategoryList } from '../components/CategoryList.tsx'
import { NewTaskModal } from '../components/NewTaskModal.tsx'
import { CategoryModal } from '../components/CategoryModal.tsx'
import { useToast } from '../components/Toast.tsx'

type StatusFilter = 'active' | 'all' | Status

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  ...STATUSES,
  { key: 'all', label: 'All' },
]

function readFilter(key: string): StatusFilter | null {
  try {
    const value = localStorage.getItem(key)
    return FILTERS.some((f) => f.key === value) ? (value as StatusFilter) : null
  } catch {
    return null
  }
}

function writeFilter(key: string, value: StatusFilter) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable: the filter just won't be remembered
  }
}

// Order of groups on screen: what is being worked on comes first.
const GROUP_ORDER: Status[] = ['in_progress', 'review', 'open', 'done']

export function TasksPage() {
  const me = useMe()
  const { categoryId: categoryParam } = useParams()
  const [params, setParams] = useSearchParams()
  const { categories, categoryById, users, can, canCreateIn, reloadCategories } = useData()
  const toast = useToast()

  const categoryId = categoryParam ? Number(categoryParam) : null
  const category = categoryId ? categoryById.get(categoryId) : undefined
  const assignee = params.get('assignee') ?? ''
  // A category is a plan in a fixed order, so it shows finished work too; cross-category views focus on what is left.
  const defaultFilter: StatusFilter = categoryId ? 'all' : 'active'
  // The chosen filter is remembered per person and per view (each category, All tasks, My tasks).
  const filterKey = `taskhub.status.${me.id}.${categoryId ? `c${categoryId}` : assignee === 'me' ? 'my' : 'all'}`
  const [filterVersion, setFilterVersion] = useState(0)
  const savedFilter = useMemo(() => readFilter(filterKey), [filterKey, filterVersion])
  const statusFilter = (params.get('status') ?? savedFilter ?? defaultFilter) as StatusFilter
  const openTaskId = params.get('task') ? Number(params.get('task')) : null

  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingCategory, setEditingCategory] = useState(false)
  const [arranging, setArranging] = useState(false)

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

  const loadTasks = useCallback(() => {
    const qs = new URLSearchParams()
    if (categoryId) qs.set('categoryId', String(categoryId))
    if (assignee) qs.set('assignee', assignee)
    if (query.trim()) qs.set('q', query.trim())
    return api.get<Task[]>(`/tasks?${qs}`)
  }, [categoryId, assignee, query])

  useEffect(() => {
    let cancelled = false
    setTasks(null)
    const t = setTimeout(() => {
      loadTasks().then((r) => !cancelled && setTasks(r)).catch(toast.error)
    }, query ? 200 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [loadTasks, query, toast])

  useEffect(() => {
    setArranging(false)
    setSections([])
    if (categoryId) api.get<Section[]>(`/categories/${categoryId}/sections`).then(setSections).catch(toast.error)
  }, [categoryId, toast])

  const matches = useCallback(
    (t: Task) => (statusFilter === 'all' ? true : statusFilter === 'active' ? t.status !== 'done' : t.status === statusFilter),
    [statusFilter],
  )

  const visible = useMemo(() => (tasks ?? []).filter(matches), [tasks, matches])
  const groups = GROUP_ORDER.map((status) => ({ status, items: visible.filter((t) => t.status === status) })).filter((g) => g.items.length)
  const taskById = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks])

  const upsert = useCallback(
    (task: Task) =>
      setTasks((list) => {
        if (!list) return list
        const fits = !task.archivedAt && (!categoryId || task.categoryId === categoryId) && (assignee !== 'me' || task.assigneeId === me.id)
        const without = list.filter((t) => t.id !== task.id)
        return fits ? [task, ...without].sort((a, b) => GROUP_ORDER.indexOf(a.status) - GROUP_ORDER.indexOf(b.status) || b.updatedAt - a.updatedAt) : without
      }),
    [categoryId, assignee, me.id],
  )

  const take = async (task: Task) => {
    try {
      upsert(await api.post<Task>(`/tasks/${task.id}/take`))
      reloadCategories()
    } catch (err) {
      toast.error(err)
    }
  }

  const open = (t: Task) => setParam('task', String(t.id))

  const title = category ? category.name : assignee === 'me' ? 'My tasks' : 'All tasks'
  const hasCategories = categories.some((c) => !c.archived)
  // Inside a category: may I add here? Elsewhere: is there any category I may add to?
  const canCreate = category ? !category.archived && canCreateIn(category.id) : categories.some((c) => !c.archived && canCreateIn(c.id))
  const canTake = can('take_tasks') || can('assign_tasks')
  const canArrange = Boolean(category) && (can('manage_categories') || can('edit_tasks'))
  const filtersActive = statusFilter !== 'all' || Boolean(assignee) || Boolean(query.trim())

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
          !arranging && (
            <>
              {category && can('manage_categories') && (
                <button className="btn btn-ghost" onClick={() => setEditingCategory(true)}>
                  <Pencil size={14} /> Edit
                </button>
              )}
              {canArrange && (
                <button className="btn btn-ghost" onClick={() => setArranging(true)}>
                  <ArrowUpDown size={14} /> Arrange
                </button>
              )}
              {canCreate && (
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Plus size={14} /> New task
                </button>
              )}
            </>
          )
        }
      />

      {arranging && categoryId ? (
        <ArrangeList
          categoryId={categoryId}
          sections={sections}
          onCancel={() => setArranging(false)}
          onSaved={(s) => {
            setSections(s)
            setArranging(false)
            loadTasks().then(setTasks).catch(toast.error)
            toast.info('Order saved')
          }}
        />
      ) : (
        <>
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Status filter">
              {FILTERS.map((f) => (
                <button key={f.key} role="tab" aria-selected={statusFilter === f.key} className={cx(statusFilter === f.key && 'active')} onClick={() => {
                    writeFilter(filterKey, f.key)
                    setFilterVersion((v) => v + 1)
                    setParam('status', null)
                  }}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="toolbar-right">
              <label className="search">
                <Search size={14} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or #id" aria-label="Search tasks" />
              </label>
              <Select
                variant="sm"
                aria-label="Assignee filter"
                value={assignee}
                onChange={(v) => setParam('assignee', v)}
                options={[
                  { value: '', label: 'Anyone', icon: <Users size={14} className="muted" /> },
                  { value: 'me', label: 'Assigned to me', icon: <Avatar user={me} size={18} /> },
                  { value: 'none', label: 'Unassigned', icon: <span className="avatar avatar-empty" style={{ width: 18, height: 18 }} /> },
                  ...users
                    .filter((u) => u.id !== me.id && u.status !== 'invited')
                    .map((u) => ({ value: String(u.id), label: displayName(u), icon: <Avatar user={u} size={18} /> })),
                ]}
              />
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
          ) : (category ? !visible.length && !(sections.length && !filtersActive) : groups.length === 0) ? (
            <Empty icon={<Layers size={20} />} title={query ? 'Nothing matches your search' : 'No tasks here'}>
              {canCreate && !query && (
                <button className="btn" onClick={() => setCreating(true)}>
                  <Plus size={14} /> New task
                </button>
              )}
            </Empty>
          ) : category ? (
            <CategoryList
              tasks={tasks}
              sections={sections}
              matches={matches}
              showEmptySections={!filtersActive}
              openTaskId={openTaskId}
              canTake={canTake}
              onOpen={open}
              onTake={take}
            />
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
                    {g.items.map((t) => (
                      <li key={t.id}>
                        <TaskRow
                          task={t}
                          parent={t.parentId ? taskById.get(t.parentId) : undefined}
                          showCategory
                          selected={openTaskId === t.id}
                          canTake={canTake}
                          onOpen={open}
                          onTake={take}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {openTaskId && (
        <TaskPanel
          key={openTaskId}
          taskId={openTaskId}
          onClose={() => setParam('task', null)}
          onOpenTask={(id) => setParam('task', String(id))}
          onChanged={upsert}
          onDeleted={(id) => setTasks((list) => list?.filter((t) => t.id !== id && t.parentId !== id) ?? list)}
        />
      )}
      {creating && <NewTaskModal defaultCategoryId={category && !category.archived ? category.id : undefined} onClose={() => setCreating(false)} onCreated={(t) => (upsert(t), setParam('task', String(t.id)))} />}
      {editingCategory && category && (
        <CategoryModal category={category} onClose={() => setEditingCategory(false)} onArchivedDone={() => loadTasks().then(setTasks).catch(toast.error)} />
      )}
    </div>
  )
}
