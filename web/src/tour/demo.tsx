/**
 * Stand-ins the tour draws when the real thing is missing or too uneven to explain on, for example
 * a finished task in a category that has none yet. They exist only on screen, only during their
 * steps, and cannot be clicked.
 */
import { createContext, useContext } from 'react'
import { Image, ListChecks } from 'lucide-react'
import { useData, useMe } from '../store.tsx'
import { Avatar, DueBadge, LabelChip, PriorityIcon, StatusIcon } from '../components/ui.tsx'

/** finished: a done task; take: an unassigned one; row: one with every part filled in, to explain a row. */
export type TourDemo = 'finished' | 'take' | 'row'

export const TourDemoContext = createContext<TourDemo | null>(null)

/** Which stand-in the current tour step needs, if any. */
export const useTourDemo = () => useContext(TourDemoContext)

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DemoTaskRow({ kind }: { kind: TourDemo }) {
  const { statuses, priorities } = useData()
  const me = useMe()
  const type = kind === 'finished' ? 'done' : kind === 'row' ? 'active' : 'todo'
  const status = statuses.find((s) => s.type === type) ?? statuses[0]
  const priority = kind === 'row' ? priorities[0] : (priorities.find((p) => p.isDefault) ?? priorities[0])
  const title = kind === 'finished' ? 'A finished task' : kind === 'take' ? 'A task nobody has taken yet' : 'An example task'

  return (
    <div className={`task-row task-row-demo${kind === 'finished' ? ' task-row-done' : ''}`} aria-hidden>
      {priority && <PriorityIcon id={priority.id} />}
      <span className="task-id">#0</span>
      {status && <StatusIcon id={status.id} />}
      <span className="task-title truncate">{title}</span>
      {kind === 'row' ? (
        <>
          <span className="demo-chips">
            <span className="task-chip">
              <ListChecks size={13} /> 1/3
            </span>
            <span className="task-chip">
              <Image size={13} /> 2
            </span>
          </span>
          <span className="task-labels">
            <LabelChip label={{ name: 'backend', color: '#0090ff' }} />
            <LabelChip label={{ name: 'blocked', color: '#dc2626' }} />
          </span>
          <DueBadge due={tomorrow()} done={false} />
          <span className="task-time muted small">2 hours ago</span>
          <span className="task-assignee">
            <Avatar user={me} size={22} />
          </span>
        </>
      ) : (
        <>
          <span className="badge">Example</span>
          <span className="task-assignee">
            {kind === 'take' ? <span className="btn btn-sm btn-ghost take-btn">Take</span> : <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} />}
          </span>
        </>
      )}
    </div>
  )
}
