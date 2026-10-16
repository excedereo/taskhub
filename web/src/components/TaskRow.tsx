import { CornerDownRight, Image, ListChecks } from 'lucide-react'
import { useData } from '../store.tsx'
import type { Task } from '../types.ts'
import { cx, formatDate, timeAgo } from '../util.ts'
import { Avatar, DueBadge, LabelChip, PriorityIcon, StatusIcon } from './ui.tsx'

type Props = {
  task: Task
  /** Shown as "in #12 Parent" when the subtask is listed away from its parent. */
  parent?: Pick<Task, 'id' | 'title'>
  showCategory?: boolean
  nested?: boolean
  selected?: boolean
  canTake?: boolean
  onOpen: (task: Task) => void
  onTake: (task: Task) => void
}

export function TaskRow({ task: t, parent, showCategory, nested, selected, canTake, onOpen, onTake }: Props) {
  const { userById, categoryById, labelById } = useData()
  const labels = t.labelIds.map((id) => labelById.get(id)).filter((l) => l !== undefined)
  const assignee = t.assigneeId ? userById.get(t.assigneeId) : null

  return (
    <div
      role="button"
      tabIndex={0}
      className={cx('task-row', selected && 'selected', nested && 'task-row-nested', t.status === 'done' && 'task-row-done')}
      onClick={() => onOpen(t)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(t)}
    >
      {nested && <CornerDownRight size={14} className="nest-mark" aria-hidden />}
      <PriorityIcon priority={t.priority} />
      <span className="task-id">#{t.id}</span>
      <StatusIcon status={t.status} />
      <span className="task-title truncate">
        {t.title}
        {parent && <span className="task-parent"> · in #{parent.id} {parent.title}</span>}
      </span>
      {t.subtaskCount > 0 && (
        <span className={cx('task-chip', t.subtaskDone === t.subtaskCount && 'task-chip-done')} title={`${t.subtaskDone} of ${t.subtaskCount} subtasks done`}>
          <ListChecks size={13} /> {t.subtaskDone}/{t.subtaskCount}
        </span>
      )}
      {t.attachmentCount > 0 && (
        <span className="task-chip" title={`${t.attachmentCount} image(s)`}>
          <Image size={13} /> {t.attachmentCount}
        </span>
      )}
      {labels.length > 0 && (
        <span className="task-labels">
          {labels.slice(0, 3).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {labels.length > 3 && <span className="muted small">+{labels.length - 3}</span>}
        </span>
      )}
      <DueBadge due={t.dueDate} done={t.status === 'done'} />
      {showCategory && <span className="badge task-category">{categoryById.get(t.categoryId)?.name}</span>}
      <span className="task-time muted small" title={formatDate(t.updatedAt)}>
        {timeAgo(t.updatedAt)}
      </span>
      <span className="task-assignee">
        {assignee ? (
          <Avatar user={assignee} size={22} />
        ) : canTake && t.status !== 'done' ? (
          <button className="btn btn-sm btn-ghost take-btn" onClick={(e) => (e.stopPropagation(), onTake(t))}>
            Take
          </button>
        ) : (
          <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} title="Unassigned" />
        )}
      </span>
    </div>
  )
}
