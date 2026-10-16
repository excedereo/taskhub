/**
 * Stand-ins the tour draws when the real thing is missing, for example a finished task in a category
 * that has none yet. They exist only on screen, only during that step, and cannot be clicked.
 */
import { createContext, useContext } from 'react'
import { useData } from '../store.tsx'
import { PriorityIcon, StatusIcon } from '../components/ui.tsx'

export type TourDemo = 'finished' | 'take'

export const TourDemoContext = createContext<TourDemo | null>(null)

/** Which stand-in the current tour step needs, if any. */
export const useTourDemo = () => useContext(TourDemoContext)

export function DemoTaskRow({ kind }: { kind: TourDemo }) {
  const { statuses, priorities } = useData()
  const status = statuses.find((s) => s.type === (kind === 'finished' ? 'done' : 'todo')) ?? statuses[0]
  const priority = priorities.find((p) => p.isDefault) ?? priorities[0]
  return (
    <div className={`task-row task-row-demo${kind === 'finished' ? ' task-row-done' : ''}`} aria-hidden>
      {priority && <PriorityIcon id={priority.id} />}
      <span className="task-id">#0</span>
      {status && <StatusIcon id={status.id} />}
      <span className="task-title truncate">{kind === 'finished' ? 'A finished task' : 'A task nobody has taken yet'}</span>
      <span className="badge">Example</span>
      <span className="task-assignee">
        {kind === 'take' ? <span className="btn btn-sm btn-ghost take-btn">Take</span> : <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} />}
      </span>
    </div>
  )
}
