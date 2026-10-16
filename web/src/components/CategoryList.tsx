import { useEffect, useState } from 'react'
import { CornerDownRight, GripVertical, Plus, SeparatorHorizontal, Trash2 } from 'lucide-react'
import { api } from '../api.ts'
import type { Section, Task } from '../types.ts'
import { cx } from '../util.ts'
import { StatusIcon } from './ui.tsx'
import { TaskRow } from './TaskRow.tsx'
import { useToast } from './Toast.tsx'
import { useData } from '../store.tsx'
import { moveItem, useDragSort } from './useDragSort.ts'
import { DemoTaskRow, useTourDemo } from '../tour/demo.tsx'

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

/**
 * The category page: unfinished work in the manual order with its sections,
 * and everything that is done collected at the bottom under "Finished", most recent first.
 */
export function CategoryList({ tasks, sections, matches, showEmptySections, openTaskId, canTake, onOpen, onTake }: ListProps) {
  const { isDone } = useData()
  const blocks = buildBlocks(tasks, sections)
  const visibleRows = (entries: Entry[]) =>
    entries.map((e) => ({ ...e, kids: e.kids.filter(matches) })).filter((e) => matches(e.task) || e.kids.length)
  const renderRows = (rows: Entry[]) =>
    rows.flatMap(({ task, kids }) => [
      <li key={task.id}>
        <TaskRow task={task} nested={Boolean(task.parentId)} selected={openTaskId === task.id} canTake={canTake} onOpen={onOpen} onTake={onTake} />
      </li>,
      ...kids.map((k) => (
        <li key={k.id}>
          <TaskRow task={k} nested selected={openTaskId === k.id} canTake={canTake} onOpen={onOpen} onTake={onTake} />
        </li>
      )),
    ])
  const demo = useTourDemo()
  const finished = visibleRows(
    blocks.flatMap((b) => b.entries).filter((e) => isDone(e.task)),
  ).sort((a, b) => (b.task.closedAt ?? 0) - (a.task.closedAt ?? 0))

  return (
    <div className="stages">
      {blocks.map((b) => {
        const rows = visibleRows(b.entries.filter((e) => !isDone(e.task)))
        if (!rows.length && !(b.section && showEmptySections)) return null
        // The counter still covers finished tasks, so a section shows how far along it is.
        const done = b.entries.filter((e) => isDone(e.task)).length

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
              <ul className="task-list">{renderRows(rows)}</ul>
            ) : (
              <p className="stage-empty">{b.entries.length && done === b.entries.length ? 'All done' : 'Nothing here yet'}</p>
            )}
          </section>
        )
      })}

      {finished.length > 0 && (
        <section className="stage stage-finished">
          <h2 className="stage-head">
            <span className="stage-title">Finished</span>
            <span className="stage-line" aria-hidden />
            <span className="muted small">{finished.length}</span>
          </h2>
          <ul className="task-list">{renderRows(finished)}</ul>
        </section>
      )}
      {finished.length === 0 && demo === 'finished' && (
        <section className="stage stage-finished">
          <h2 className="stage-head">
            <span className="stage-title">Finished</span>
            <span className="stage-line" aria-hidden />
          </h2>
          <ul className="task-list">
            <li>
              <DemoTaskRow kind="finished" />
            </li>
          </ul>
        </section>
      )}
    </div>
  )
}

type DraftItem =
  | { kind: 'section'; key: string; id?: number; title: string }
  | { kind: 'task'; key: string; task: Task; kids: Task[] }

let draftSeq = 0

function Grip({ label, ...props }: { label: string } & ReturnType<ReturnType<typeof useDragSort>['handle']>) {
  return (
    <button type="button" className="grip" aria-label={label} title="Drag to reorder (or focus and use the arrow keys)" {...props}>
      <GripVertical size={16} />
    </button>
  )
}

/** Subtasks reorder only inside their parent, so each parent gets its own sortable list. */
function KidList({ kids, onReorder }: { kids: Task[]; onReorder: (kids: Task[]) => void }) {
  const { isDone } = useData()
  const sort = useDragSort(kids.length, (from, to) => onReorder(moveItem(kids, from, to)))
  return (
    <ul className="arrange-kids">
      {kids.map((k, i) => (
        <li key={k.id} ref={sort.ref(i)} style={sort.style(i)} className={cx('arrange-row arrange-kid', isDone(k) && 'task-row-done', sort.dragging === i && 'is-dragging')}>
          <Grip label={`Drag subtask ${k.title}`} {...sort.handle(i)} />
          <CornerDownRight size={14} className="nest-mark" />
          <StatusIcon id={k.statusId} />
          <span className="task-id">#{k.id}</span>
          <span className="task-title truncate">{k.title}</span>
        </li>
      ))}
    </ul>
  )
}

/** Edit mode for the manual order: drag rows by their handle, saved in one request. */
export function ArrangeList({ categoryId, sections, onSaved, onCancel }: { categoryId: number; sections: Section[]; onSaved: (s: Section[]) => void; onCancel: () => void }) {
  const { isDone } = useData()
  const toast = useToast()
  const [draft, setDraft] = useState<DraftItem[] | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sort = useDragSort(draft?.length ?? 0, (from, to) => setDraft((d) => (d ? moveItem(d, from, to) : d)))

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
        <span className="muted">Drag rows by the handle. Sections split the list into stages.</span>
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
          const dragging = sort.dragging === i
          if (item.kind === 'section') {
            return (
              <li key={item.key} ref={sort.ref(i)} style={sort.style(i)} className={cx('arrange-row arrange-section', dragging && 'is-dragging')}>
                <Grip label={`Drag section ${item.title || 'untitled'}`} {...sort.handle(i)} />
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
                <button className="icon-btn icon-btn-sm" onClick={() => update((d) => (d.splice(i, 1), d))} aria-label="Remove section" title="Remove section">
                  <Trash2 size={14} />
                </button>
              </li>
            )
          }

          return (
            <li key={item.key} ref={sort.ref(i)} style={sort.style(i)} className={cx('arrange-item', dragging && 'is-dragging')}>
              <div className={cx('arrange-row', isDone(item.task) && 'task-row-done')}>
                <Grip label={`Drag task ${item.task.title}`} {...sort.handle(i)} />
                <StatusIcon id={item.task.statusId} />
                <span className="task-id">#{item.task.id}</span>
                <span className="task-title truncate">{item.task.title}</span>
                <button className="btn btn-sm btn-ghost arrange-insert" onClick={() => insertSection(i)} title="Insert a section above this task">
                  <SeparatorHorizontal size={14} /> <span className="arrange-insert-label">Section above</span>
                </button>
              </div>
              {item.kids.length > 0 && <KidList kids={item.kids} onReorder={(kids) => update((d) => ((d[i] = { ...item, kids }), d))} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
