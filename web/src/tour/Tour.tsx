import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe, useSession } from '../store.tsx'
import type { Section, Task } from '../types.ts'
import { cx } from '../util.ts'
import { TOUR_MODULES, type TourCtx, type TourModule, type TourStep } from './modules.tsx'
import { TourDemoContext } from './demo.tsx'

export type TourState = { seen: boolean; done: string[] }

/** A step ready to show: which guide it belongs to, the page it is on, and whether it ends its guide. */
type Planned = { module: TourModule | null; step: TourStep; path: string | null; last: boolean }

type TourApi = {
  state: TourState | null
  running: boolean
  /** Guides this person can take, everyday ones first. */
  available: TourModule[]
  /** Resolves to false when none of the chosen guides has anything to show yet. */
  start: (keys?: string[]) => Promise<boolean>
  dismiss: () => void
}

const TourContext = createContext<TourApi | null>(null)

export const useTour = () => {
  const value = useContext(TourContext)
  if (!value) throw new Error('useTour outside TourProvider')
  return value
}

/** Opens or closes the sidebar on phones, where it slides over the page. Layout listens for this. */
export const MENU_EVENT = 'taskhub:menu'
const setMenu = (open: boolean) => window.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: open }))
const narrow = () => window.matchMedia('(max-width: 860px)').matches

const selectorOf = (target: string) => (target.startsWith('.') || target.startsWith('[') ? target : `[data-tour="${target}"]`)

/** The permission side of the context, known without loading anything. */
function useBaseCtx(): Pick<TourCtx, 'can' | 'instanceName' | 'statuses' | 'priorities' | 'createIn' | 'canCreate'> {
  const { can, statuses, priorities, categories, canCreateIn } = useData()
  const { meta } = useSession()
  const me = useMe()
  return useMemo(() => {
    const visible = categories.filter((c) => !c.archived)
    return {
      can,
      instanceName: meta?.instanceName ?? 'Taskhub',
      statuses,
      priorities,
      createIn: me.permissions.includes('admin') || me.createCategoryIds === null ? null : visible.filter((c) => canCreateIn(c.id)).map((c) => c.name),
      canCreate: visible.some((c) => canCreateIn(c.id)),
    }
  }, [can, meta?.instanceName, statuses, priorities, categories, canCreateIn, me])
}

export function TourProvider({ children }: { children: ReactNode }) {
  const base = useBaseCtx()
  const { statusById } = useData()
  const navigate = useNavigate()
  const location = useLocation()
  const [state, setState] = useState<TourState | null>(null)
  const [plan, setPlan] = useState<Planned[] | null>(null)
  const [index, setIndex] = useState(0)
  const forward = useRef(true)
  const [ctx, setCtx] = useState<TourCtx | null>(null)

  useEffect(() => {
    api.get<TourState>('/me/tour').then(setState).catch(() => setState({ seen: true, done: [] }))
  }, [])

  const save = useCallback((body: { seen?: boolean; done?: string[] }) => {
    api.put<TourState>('/me/tour', body).then(setState).catch(() => {})
  }, [])

  // Which guides apply needs only permissions; the example task and category are picked when a tour starts.
  const permCtx = useMemo<TourCtx>(() => ({ ...base, categoryId: null, taskId: null, hasSections: false, hasTasks: false }), [base])
  const available = useMemo(() => TOUR_MODULES.filter((m) => m.key === 'task' || m.key === 'categories' || m.when(permCtx)), [permCtx])

  const start = useCallback(
    async (keys?: string[]) => {
      // Pick something real to show: the category with the most tasks, and an unfinished task in it.
      const tasks = await api.get<Task[]>('/tasks').catch(() => [] as Task[])
      const isDone = (t: Task) => statusById.get(t.statusId)?.type === 'done'
      const counts = new Map<number, number>()
      for (const t of tasks) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
      const categoryId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const inCategory = tasks.filter((t) => t.categoryId === categoryId && !t.parentId)
      const example = inCategory.find((t) => !isDone(t) && t.subtaskCount > 0) ?? inCategory.find((t) => !isDone(t)) ?? inCategory[0]
      const sections = categoryId ? await api.get<Section[]>(`/categories/${categoryId}/sections`).catch(() => []) : []
      const full: TourCtx = { ...base, categoryId, taskId: example?.id ?? null, hasSections: sections.length > 0, hasTasks: tasks.length > 0 }

      const chosen = TOUR_MODULES.filter((m) => (keys ? keys.includes(m.key) : !m.admin) && m.when(full))
      const steps: Planned[] = []
      // Every step gets a definite page: its own, or the one of the step before it.
      let path: string | null = location.pathname + location.search
      for (const m of chosen) {
        const own = m.steps.filter((s) => !s.when || s.when(full))
        own.forEach((step, i) => {
          const route = typeof step.route === 'function' ? step.route(full) : step.route
          if (route) path = route
          steps.push({ module: m, step, path, last: i === own.length - 1 })
        })
      }
      if (!keys) {
        const adminLeft = TOUR_MODULES.filter((m) => m.admin && m.when(full))
        steps.push({
          module: null,
          path,
          last: true,
          step: {
            title: 'That’s the basics',
            body: adminLeft.length
              ? `You can replay any part of this tour from Settings, under Guides. There are also guides for the tools that manage the workspace: ${adminLeft.map((m) => m.title).join(', ')}.`
              : 'You can replay any part of this tour from Settings, under Guides.',
          },
        })
      }
      if (!steps.length) return false
      forward.current = true
      setCtx(full)
      setIndex(0)
      setPlan(steps)
      save({ seen: true })
      return true
    },
    [base, statusById, save, location.pathname, location.search],
  )

  const close = useCallback(() => {
    setPlan(null)
    if (narrow()) setMenu(false)
  }, [])

  const current = plan?.[index] ?? null

  const next = useCallback(() => {
    if (!plan) return
    const here = plan[index]
    if (here.module && here.last) save({ done: [here.module.key] })
    forward.current = true
    if (index + 1 >= plan.length) close()
    else setIndex(index + 1)
  }, [plan, index, save, close])

  const back = useCallback(() => {
    forward.current = false
    setIndex((i) => Math.max(0, i - 1))
  }, [])
  // A missing optional target: move on in the direction the person was going (never past the first step).
  const skip = useCallback(() => (forward.current || index === 0 ? next() : back()), [index, next, back])

  // Go to the step's page, and open the menu on phones when the step points into it.
  const path = current?.path ?? null
  const sidebar = Boolean(current?.step.sidebar)
  useEffect(() => {
    if (!plan) return
    if (path && location.pathname + location.search !== path) navigate(path)
    // After the navigation settles, since a page change closes the menu by itself.
    const t = setTimeout(() => narrow() && setMenu(sidebar), 60)
    return () => clearTimeout(t)
    // Runs per step, not on every URL change: the person may wander, the tour only moves on Next and Back.
  }, [plan, index])

  useEffect(() => {
    if (!plan) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [plan, next, back, close])

  const value = useMemo<TourApi>(() => ({ state, running: Boolean(plan), available, start, dismiss: () => save({ seen: true }) }), [state, plan, available, start, save])

  return (
    <TourContext.Provider value={value}>
      <TourDemoContext.Provider value={current?.step.demo ?? null}>{children}</TourDemoContext.Provider>
      {current && ctx && plan && (
        <TourOverlay
          step={current.step}
          ctx={ctx}
          moduleTitle={current.module?.title ?? null}
          index={index}
          total={plan.length}
          onNext={next}
          onSkip={skip}
          onBack={index > 0 ? back : undefined}
          onClose={close}
        />
      )}
    </TourContext.Provider>
  )
}

type Box = { top: number; left: number; width: number; height: number }

/**
 * Finds the step's element once its page has rendered, and keeps following it. Until the new element
 * shows up, the previous box stays, so the highlight and the card glide from where they were.
 */
function useTargetBox(target: string | undefined, patience: number, stepKey: number) {
  const [box, setBox] = useState<Box | null>(null)
  const [state, setState] = useState<'looking' | 'found' | 'missing'>('looking')

  useLayoutEffect(() => {
    if (!target) {
      setBox(null)
      setState('missing')
      return
    }
    setState('looking')
    const selector = selectorOf(target)
    let el: Element | null = null
    let scrolled = false
    const started = Date.now()
    const measure = () => {
      el = el?.isConnected ? el : document.querySelector(selector)
      const r = el?.getBoundingClientRect()
      if (r && r.width > 0 && r.height > 0) {
        if (!scrolled) {
          scrolled = true
          // Tall blocks (like the role editor) are shown from their top, the rest centred.
          if (r.top < 0 || r.bottom > window.innerHeight) el!.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? 'start' : 'center' })
        }
        const n = el!.getBoundingClientRect()
        setBox((b) => (b && b.top === n.top && b.left === n.left && b.width === n.width && b.height === n.height ? b : { top: n.top, left: n.left, width: n.width, height: n.height }))
        setState('found')
      } else if (Date.now() - started > patience) {
        // Not on the page: the card moves to the middle of the screen (or the step is skipped).
        setBox(null)
        setState('missing')
      }
    }
    measure()
    const timer = setInterval(measure, 100)
    window.addEventListener('resize', measure)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', measure)
    }
  }, [target, patience, stepKey])

  return { box, state }
}

const CARD_W = 340
const GAP = 12
const PAD = 6

function TourOverlay({ step, ctx, moduleTitle, index, total, onNext, onSkip, onBack, onClose }: {
  step: TourStep
  ctx: TourCtx
  moduleTitle: string | null
  index: number
  total: number
  onNext: () => void
  onSkip: () => void
  onBack?: () => void
  onClose: () => void
}) {
  // Optional parts are already on screen or not there at all, so there is no point waiting long for them.
  const { box, state } = useTargetBox(step.target, step.optional ? 700 : 2000, index)
  const skipping = state === 'missing' && Boolean(step.target) && Boolean(step.optional)
  useEffect(() => {
    if (skipping) onSkip()
  }, [skipping, onSkip])

  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(200)
  useLayoutEffect(() => {
    if (cardRef.current && cardRef.current.offsetHeight !== cardH) setCardH(cardRef.current.offsetHeight)
  })

  const vw = window.innerWidth
  const vh = window.innerHeight
  let pos: { top: number; left: number; width: number }
  if (!box) {
    pos = { width: Math.min(CARD_W + 60, vw - 32), left: 0, top: Math.max(16, vh / 2 - cardH / 2) }
    pos.left = (vw - pos.width) / 2
  } else if (vw < 640) {
    // Phones: a full-width card above or below the highlighted part.
    const below = box.top + box.height / 2 < vh / 2
    pos = { width: vw - 24, left: 12, top: below ? Math.min(vh - cardH - 12, box.top + box.height + GAP) : Math.max(12, box.top - cardH - GAP) }
  } else {
    const width = CARD_W
    const clampTop = (t: number) => Math.min(Math.max(12, t), vh - cardH - 12)
    const clampLeft = (l: number) => Math.min(Math.max(12, l), vw - width - 12)
    if (vw - (box.left + box.width) >= width + GAP + 12) pos = { width, left: box.left + box.width + GAP, top: clampTop(box.top) }
    else if (vh - (box.top + box.height) >= cardH + GAP + 12) pos = { width, left: clampLeft(box.left), top: box.top + box.height + GAP }
    else if (box.top >= cardH + GAP + 12) pos = { width, left: clampLeft(box.left), top: box.top - cardH - GAP }
    else pos = { width, left: clampLeft(box.left - width - GAP), top: clampTop(box.top) }
  }

  const body = typeof step.body === 'function' ? step.body(ctx) : step.body
  const last = index === total - 1

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Clicks outside the card are swallowed: the tour shows things, it never presses them. */}
      <div className={cx('tour-shield', !box && 'tour-dim')} />
      {box && <div className="tour-spot" style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }} />}
      <div ref={cardRef} className={cx('tour-card', skipping && 'tour-card-wait')} style={{ top: pos.top, left: pos.left, width: pos.width }}>
        <div className="tour-head">
          <span className="muted small">
            {moduleTitle ? `${moduleTitle} · ` : ''}
            {index + 1} of {total}
          </span>
          <button type="button" className="icon-btn icon-btn-sm" onClick={onClose} aria-label="End the tour" title="End the tour (Esc)">
            <X size={14} />
          </button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <div className="tour-body">{typeof body === 'string' ? <p>{body}</p> : body}</div>
        <div className="tour-foot">
          <div className="tour-bar" aria-hidden>
            <span style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
          {onBack && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
              Back
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={onNext} autoFocus>
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The first-visit invitation. Later dismisses it for this visit only; No thanks for good. */
export function TourPrompt() {
  const { state, running, start, dismiss } = useTour()
  const [later, setLater] = useState(false)
  if (!state || state.seen || running || later) return null
  return (
    <div className="tour-prompt" role="dialog" aria-label="Take the tour">
      <strong>New here?</strong>
      <p className="muted small">A short tour shows you around. It only covers what your role can use and does not change anything.</p>
      <div className="row gap-xs">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => start()}>
          Start the tour
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLater(true)}>
          Later
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={dismiss}>
          No thanks
        </button>
      </div>
    </div>
  )
}
