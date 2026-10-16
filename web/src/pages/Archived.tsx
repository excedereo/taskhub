import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, Hash, Layers, Search } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import type { Task } from '../types.ts'
import { formatDate, timeAgo } from '../util.ts'
import { Empty, PageHeader, StatusIcon } from '../components/ui.tsx'
import { Select } from '../components/Select.tsx'
import { TaskPanel } from '../components/TaskPanel.tsx'
import { useToast } from '../components/Toast.tsx'

export function ArchivedPage() {
  const me = useMe()
  const { categories, categoryById, can, reloadCategories } = useData()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [query, setQuery] = useState('')
  const categoryId = params.get('category') ?? ''
  const openTaskId = params.get('task') ? Number(params.get('task')) : null

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams((p) => {
        const next = new URLSearchParams(p)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      }),
    [setParams],
  )

  const load = useCallback(() => {
    const qs = new URLSearchParams({ archived: '1' })
    if (categoryId) qs.set('categoryId', categoryId)
    if (query.trim()) qs.set('q', query.trim())
    return api.get<Task[]>(`/tasks?${qs}`)
  }, [categoryId, query])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => load().then((r) => !cancelled && setTasks(r)).catch(toast.error), query ? 200 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [load, query, toast])

  const restore = async (task: Task) => {
    try {
      await api.post(`/tasks/${task.id}/archive`, { archived: false })
      setTasks((list) => list?.filter((t) => t.id !== task.id && t.parentId !== task.id) ?? list)
      reloadCategories()
      toast.info(`#${task.id} restored`)
    } catch (err) {
      toast.error(err)
    }
  }

  const ids = new Set((tasks ?? []).map((t) => t.id))
  // Subtasks archived together with their parent are listed under it, not on their own.
  const top = (tasks ?? []).filter((t) => !t.parentId || !ids.has(t.parentId))
  const kidsOf = (id: number) => (tasks ?? []).filter((t) => t.parentId === id)
  const canRestore = (t: Task) => can('edit_tasks') || t.creatorId === me.id

  return (
    <div className="page">
      <PageHeader title="Archived" description="Tasks taken out of lists and analytics. Nothing is lost: history, images and subtasks stay with them." />

      <div className="toolbar">
        <label className="search">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or #id" aria-label="Search archived tasks" />
        </label>
        <div className="toolbar-right">
          <Select
            variant="sm"
            aria-label="Category"
            value={categoryId}
            onChange={(v) => setParam('category', v)}
            options={[
              { value: '', label: 'All categories', icon: <Layers size={14} className="muted" /> },
              ...categories.map((c) => ({ value: String(c.id), label: c.name, icon: <Hash size={14} className="muted" /> })),
            ]}
          />
        </div>
      </div>

      {tasks === null ? (
        <div className="skeleton-list">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : top.length === 0 ? (
        <Empty icon={<Archive size={20} />} title={query ? 'Nothing matches your search' : 'The archive is empty'}>
          Archive a task from its panel, or finished tasks of a whole category from its Edit dialog.
        </Empty>
      ) : (
        <ul className="task-list">
          {top.map((t) => {
            const kids = kidsOf(t.id)
            return (
              <li key={t.id}>
                <div role="button" tabIndex={0} className="task-row" onClick={() => setParam('task', String(t.id))} onKeyDown={(e) => e.key === 'Enter' && setParam('task', String(t.id))}>
                  <span className="task-id">#{t.id}</span>
                  <StatusIcon status={t.status} />
                  <span className="task-title truncate">{t.title}</span>
                  {kids.length > 0 && <span className="task-chip">+{kids.length} subtask(s)</span>}
                  <span className="badge task-category">{categoryById.get(t.categoryId)?.name}</span>
                  <span className="task-time muted small" title={t.archivedAt ? formatDate(t.archivedAt) : undefined}>
                    {t.archivedAt ? timeAgo(t.archivedAt) : ''}
                  </span>
                  {canRestore(t) && (
                    <button className="btn btn-sm" onClick={(e) => (e.stopPropagation(), restore(t))}>
                      <ArchiveRestore size={14} /> Restore
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {openTaskId && (
        <TaskPanel
          key={openTaskId}
          taskId={openTaskId}
          onClose={() => setParam('task', null)}
          onOpenTask={(id) => setParam('task', String(id))}
          onChanged={(task) => !task.archivedAt && setTasks((list) => list?.filter((t) => t.id !== task.id && t.parentId !== task.id) ?? list)}
          onDeleted={(id) => setTasks((list) => list?.filter((t) => t.id !== id && t.parentId !== id) ?? list)}
        />
      )}
    </div>
  )
}
