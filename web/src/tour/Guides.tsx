import { Check, Play } from 'lucide-react'
import { useToast } from '../components/Toast.tsx'
import { Foldable } from '../components/ui.tsx'
import { useTour } from './Tour.tsx'
import type { TourModule } from './modules.tsx'

/** Every guide this person can take, to replay the tour piece by piece. */
export function Guides() {
  const { available, state, start } = useTour()
  const toast = useToast()
  const everyday = available.filter((m) => !m.admin)
  const admin = available.filter((m) => m.admin)

  const run = (keys?: string[]) =>
    start(keys).then((ok) => {
      if (!ok) toast.info('Nothing to show here yet: this part needs at least one task or category you can see.')
    })

  const list = (items: TourModule[]) => (
    <ul className="guide-list">
      {items.map((m) => {
        const done = state?.done.includes(m.key)
        return (
          <li key={m.key}>
            <span className="stack min-w-0 grow">
              <span>
                {m.title} {done && <Check size={13} className="guide-done" aria-label="Done" />}
              </span>
              <span className="muted small">{m.summary}</span>
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => run([m.key])}>
              <Play size={12} /> Show
            </button>
          </li>
        )
      })}
    </ul>
  )

  return (
    <Foldable
      id="guides"
      className="card form guides-card"
      tour="guides"
      title="Guides"
      hint="Short walkthroughs of each part of Taskhub. Only the ones your role can use are listed."
      actions={
        <button type="button" className="btn btn-sm" onClick={() => run()}>
          Take the full tour
        </button>
      }
    >
      {list(everyday)}
      {admin.length > 0 && (
        <>
          <div className="row gap-xs">
            <span className="field-label grow">Managing the workspace</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => run(admin.map((m) => m.key))}>
              Show all
            </button>
          </div>
          {list(admin)}
        </>
      )}
    </Foldable>
  )
}
