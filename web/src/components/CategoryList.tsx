import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, CornerDownRight, Plus, SeparatorHorizontal, Trash2 } from 'lucide-react'
import { api } from '../api.ts'
import type { Section, Task } from '../types.ts'
import { cx } from '../util.ts'
import { StatusIcon } from './ui.tsx'
import { TaskRow } from './TaskRow.tsx'
import { useToast } from './Toast.tsx'

type Entry = { task: Task; kids: Task[] }
type Block = { section: Section | null; entries: Entry[] }

/**
 * Splits a flat task list into the category's manual layout: sections and top-level tasks
 * share one order, subtasks sit under their parent. Subtasks whose parent is not in the list
 * (filtered out by search) are shown on their own at the end.
 */
function buildBlocks(tasks: Task[], sections: Section[]): Block[] {
  const ids = new Set(tasks.map((t) => t.id))
  const kids = new Map<number, Task[]>()
  const top: Task[] = []
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t])
    else top.push(t)
  }
  const sortKey = (t: Task) => (t.parentId ? 1e9 + t.position : t.position)
  const items = [
    ...sections.map((s) => ({ pos: s.position, section: s })),
    ...top.map((t) => ({ pos: sortKey(t), task: t })),
  ].sort((a, b) => a.pos - b.pos)

  const blocks: Block[] = [{ section: null, entries: [] }]
  for (const item of items) {
    if ('section' in item) blocks.push({ section: item.section, entries: [] })
    else blocks[blocks.length - 1].entries.push({ task: item.task, kids: (kids.get(item.task.id) ?? []).sort((a, b) => a.position - b.position) })
  }
  return blocks.filter((b) => b.section || b.entries.length)
}

type ListProps = {
  tasks: Task[]
  sections: Section[]
  matches: (t: Task) => boolean
  showEmptySections: boolean
  openTaskId: number | null
  canTake: boolean
  onOpen: (t: Task) => void
  onTake: (t: Task) => void
}

export function CategoryList({ tasks, sections, matches, showEmptySections, openTaskId, canTake, onOpen, onTake }: ListProps) {
  const blocks = buildBlocks(tasks, sections)

  return (
    <div className="stages">
      {blocks.map((b) => {
        const rows = b.entries
          .map((e) => ({ ...e, kids: e.kids.filter(matches) }))
          .filter((e) => matches(e.task) || e.kids.length)
        if (!rows.length && !(b.section && showEmptySections)) return null
        const done = b.entries.filter((e) => e.task.status === 'done').length

        return (
          <section key={b.section?.id ?? 'top'} className="stage">
            {b.section && (
              <h2 className="stage-head">
                <span className="stage-title">{b.section.title}</span>
                <span className="stage-line" aria-hidden />
                <span className="muted small">
                  {done}/{b.entries.length}
                </span>
              </h2>
            )}
            {rows.length ? (
              <ul className="task-list">
                {rows.flatMap(({ task, kids }) => [
                  <li key={task.id}>
                    <TaskRow task={task} nested={Boolean(task.parentId)} selected={openTaskId === task.id} canTake={canTake} onOpen={onOpen} onTake={onTake} />
                  </li>,
                  ...kids.map((k) => (
                    <li key={k.id}>
                      <TaskRow task={k} nested selected={openTaskId === k.id} canTake={canTake} onOpen={onOpen} onTake={onTake} />
                    </li>
                  )),
                ])}
              </ul>
            ) : (
              <p className="stage-empty">Nothing here yet</p>
            )}
          </section>
        )
      })}
    </div>
  )
}

type DraftItem =
  | { kind: 'section'; key: string; id?: number; title: string }
  | { kind: 'task'; key: string; task: Task; kids: Task[] }

let draftSeq = 0

/** Edit mode for the manual order: arrows instead of drag and drop, saved in one request. */
export function ArrangeList({ categoryId, sections, onSaved, onCancel }: { categoryId: number; sections: Section[]; onSaved: (s: Section[]) => void; onCancel: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState<DraftItem[] | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Always arrange the complete list, regardless of the filters on the page.
  useEffect(() => {
    api
      .get<Task[]>(`/tasks?categoryId=${categoryId}`)
      .then((all) => {
        const items: DraftItem[] = []
        for (const b of buildBlocks(all, sections)) {
          if (b.section) items.push({ kind: 'section', key: `s${b.section.id}`, id: b.section.id, title: b.section.title })
          for (const e of b.entries) items.push({ kind: 'task', key: `t${e.task.id}`, task: e.task, kids: e.kids })
        }
        setDraft(items)
      })
      .catch(toast.error)
  }, [categoryId, sections, toast])

  if (!draft) return <div className="skeleton-list"><div className="skeleton-row" /><div className="skeleton-row" /></div>

  const update = (fn: (d: DraftItem[]) => DraftItem[]) => setDraft((d) => (d ? fn([...d]) : d))
  const move = (i: number, dir: -1 | 1) =>
    update((d) => {
      ;[d[i], d[i + dir]] = [d[i + dir], d[i]]
      return d
    })
  const moveKid = (i: number, k: number, dir: -1 | 1) =>
    update((d) => {
      const item = d[i]
      if (item.kind !== 'task') return d
      const kids = [...item.kids]
      ;[kids[k], kids[k + dir]] = [kids[k + dir], kids[k]]
      d[i] = { ...item, kids }
      return d
    })
  const insertSection = (at: number) => {
    const key = `n${++draftSeq}`
    update((d) => {
      d.splice(at, 0, { kind: 'section', key, title: '' })
      return d
    })
    setFocusKey(key)
  }

  const save = async () => {
    const empty = draft.find((x) => x.kind === 'section' && !x.title.trim())
    if (empty) {
      toast.info('Give every section a name or remove it')
      setFocusKey(empty.key)
      return
    }
    setBusy(true)
    try {
      const items = draft.map((x) =>
        x.kind === 'section' ? { type: 'section', id: x.id, title: x.title.trim() } : { type: 'task', id: x.task.id, subtasks: x.kids.map((k) => k.id) },
      )
      onSaved(await api.put<Section[]>(`/categories/${categoryId}/layout`, { items }))
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="arrange">
      <div className="arrange-bar">
        <span className="muted">Move items with the arrows. Sections split the list into stages.</span>
        <span className="grow" />
        <button className="btn btn-ghost" onClick={() => insertSection(draft.length)}>
          <Plus size={14} /> Section
        </button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          Save order
        </button>
      </div>

      {draft.length === 0 && <p className="stage-empty">This category is empty. Add a section to plan the stages.</p>}

      <ul className="arrange-list">
        {draft.map((item, i) => {
          const arrows = (
            <span className="arrange-arrows">
              <button className="icon-btn icon-btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">
                <ArrowUp size={14} />
              </button>
              <button className="icon-btn icon-btn-sm" disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label="Move down" title="Move down">
                <ArrowDown size={14} />
              </button>
            </span>
          )

          if (item.kind === 'section') {
            return (
              <li key={item.key} className="arrange-row arrange-section">
                <SeparatorHorizontal size={16} className="muted" />
                <input
                  className="arrange-input"
                  value={item.title}
                  placeholder="Section name"
                  maxLength={80}
                  autoFocus={focusKey === item.key}
                  onChange={(e) => update((d) => ((d[i] = { ...item, title: e.target.value }), d))}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                {arrows}
                <button className="icon-btn icon-btn-sm" onClick={() => update((d) => (d.splice(i, 1), d))} aria-label="Remove section" title="Remove section">
                  <Trash2 size={14} />
                </button>
              </li>
            )
          }

          return (
            <li key={item.key}>
              <div className={cx('arrange-row', item.task.status === 'done' && 'task-row-done')}>
                <StatusIcon status={item.task.status} />
                <span className="task-id">#{item.task.id}</span>
                <span className="task-title truncate">{item.task.title}</span>
                <button className="btn btn-sm btn-ghost arrange-insert" onClick={() => insertSection(i)} title="Insert a section above this task">
                  <SeparatorHorizontal size={14} /> <span className="arrange-insert-label">Section above</span>
                </button>
                {arrows}
              </div>
              {item.kids.map((k, ki) => (
                <div key={k.id} className={cx('arrange-row arrange-kid', k.status === 'done' && 'task-row-done')}>
                  <CornerDownRight size={14} className="nest-mark" />
                  <StatusIcon status={k.status} />
                  <span className="task-id">#{k.id}</span>
                  <span className="task-title truncate">{k.title}</span>
                  <span className="arrange-arrows">
                    <button className="icon-btn icon-btn-sm" disabled={ki === 0} onClick={() => moveKid(i, ki, -1)} aria-label="Move subtask up" title="Move up">
                      <ArrowUp size={14} />
                    </button>
                    <button className="icon-btn icon-btn-sm" disabled={ki === item.kids.length - 1} onClick={() => moveKid(i, ki, 1)} aria-label="Move subtask down" title="Move down">
                      <ArrowDown size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
