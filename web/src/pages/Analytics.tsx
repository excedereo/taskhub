import { useEffect, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import { STATUSES, type Status } from '../types.ts'
import { cx, displayName } from '../util.ts'
import { Avatar, PageHeader, StatusIcon } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'

type CategoryStats = {
  id: number
  name: string
  total: number
  done: number
  inProgress: number
  review: number
  open: number
  sections: { id: number | null; title: string | null; total: number; done: number }[]
  unfinished: { open: number; inProgress: number; review: number }
}

type Analytics = {
  days: number
  overview: { open: number; inProgress: number; review: number; closed: number; closedPrev: number }
  categories: CategoryStats[]
  stale: { id: number; title: string; status: Status; assigneeId: number | null; categoryId: number; idleDays: number }[]
  people?: { userId: number; inProgress: number; review: number; open: number; closed: number }[]
}

const PERIODS = [7, 30, 90] as const
const PERIOD_KEY = 'taskhub.analytics-period'
const statusLabel = (s: Status) => STATUSES.find((x) => x.key === s)?.label ?? s

function readPeriod() {
  try {
    const v = Number(localStorage.getItem(PERIOD_KEY))
    return (PERIODS as readonly number[]).includes(v) ? v : 30
  } catch {
    return 30
  }
}

export function AnalyticsPage() {
  const toast = useToast()
  const [days, setDays] = useState(readPeriod)
  const [data, setData] = useState<Analytics | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(PERIOD_KEY, String(days))
    } catch {
      // the choice just won't be remembered
    }
    setData(null)
    api.get<Analytics>(`/analytics?days=${days}`).then(setData).catch(toast.error)
  }, [days, toast])

  return (
    <div className="page analytics">
      <PageHeader
        title="Analytics"
        actions={
          <div className="segmented" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} role="tab" aria-selected={days === p} className={cx(days === p && 'active')} onClick={() => setDays(p)}>
                {p} days
              </button>
            ))}
          </div>
        }
      />

      {!data ? (
        <div className="skeleton-list">
          <div className="skeleton-row" style={{ height: 96 }} />
          <div className="skeleton-row" style={{ height: 260 }} />
        </div>
      ) : (
        <>
          <section className="tiles">
            <Tile label="Open" value={data.overview.open} />
            <Tile label="In progress" value={data.overview.inProgress} />
            <Tile label="In review" value={data.overview.review} />
            <Tile label={`Finished · ${days} days`} value={data.overview.closed} prev={data.overview.closedPrev} />
          </section>

          <div className="dash-grid">
            <section className="card dash-card">
              <h2 className="dash-title">Unfinished by category</h2>
              <CategoryDonut categories={data.categories} />
            </section>

            <section className="card dash-card">
              <h2 className="dash-title">Progress</h2>
              {data.categories.length === 0 ? (
                <p className="muted">No categories yet</p>
              ) : (
                <div className="progress-list">
                  {data.categories.map((c) => (
                    <CategoryProgress key={c.id} c={c} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {data.stale.length > 0 && (
            <section className="card dash-card">
              <h2 className="dash-title">
                Stuck <span className="muted small">7+ days in progress · 3+ days in review</span>
              </h2>
              <StaleList stale={data.stale} />
            </section>
          )}

          {data.people && data.people.length > 0 && (
            <section className="card dash-card">
              <h2 className="dash-title">Workload</h2>
              <Workload people={data.people} days={days} />
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, prev }: { label: string; value: number; prev?: number }) {
  const delta = prev === undefined ? 0 : value - prev
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <span className="stat-value">
        {value}
        {delta !== 0 && <span className="stat-delta">{delta > 0 ? `+${delta}` : `−${-delta}`}</span>}
      </span>
    </div>
  )
}

// Categorical slots from the validated palette; 'other' collects anything past the eighth category.
const MAX_SLICES = 8
const R = 80
const WIDTH = 30

function arc(start: number, end: number): string {
  const point = (a: number, r: number) => [100 + r * Math.sin(a), 100 - r * Math.cos(a)]
  const outer = R + WIDTH / 2
  const inner = R - WIDTH / 2
  // A full circle cannot be drawn as one arc, so a lone slice is split in two halves.
  if (end - start >= Math.PI * 2 - 1e-6) return `${arc(0, Math.PI)} ${arc(Math.PI, Math.PI * 2)}`
  const large = end - start > Math.PI ? 1 : 0
  const [x1, y1] = point(start, outer)
  const [x2, y2] = point(end, outer)
  const [x3, y3] = point(end, inner)
  const [x4, y4] = point(start, inner)
  return `M${x1} ${y1} A${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`
}

type Slice = { key: string; name: string; color: string; open: number; inProgress: number; review: number; total: number; href?: string }

function CategoryDonut({ categories }: { categories: CategoryStats[] }) {
  const [active, setActive] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)

  // Colors are tied to the category (its order of creation), never to its size, so they stay put between periods.
  const all: Slice[] = categories.map((c, i) => ({
    key: String(c.id),
    name: c.name,
    color: `var(--cat-${(i % MAX_SLICES) + 1})`,
    ...c.unfinished,
    total: c.unfinished.open + c.unfinished.inProgress + c.unfinished.review,
    href: `/tasks/c/${c.id}`,
  }))
  let slices = all
  if (all.length > MAX_SLICES) {
    const rest = all.slice(MAX_SLICES - 1)
    slices = [
      ...all.slice(0, MAX_SLICES - 1),
      {
        key: 'other',
        name: `Other (${rest.length})`,
        color: 'var(--cat-other)',
        open: rest.reduce((a, s) => a + s.open, 0),
        inProgress: rest.reduce((a, s) => a + s.inProgress, 0),
        review: rest.reduce((a, s) => a + s.review, 0),
        total: rest.reduce((a, s) => a + s.total, 0),
      },
    ]
  }
  const visible = slices.filter((s) => s.total > 0)
  const total = visible.reduce((a, s) => a + s.total, 0)

  if (!total) return <p className="muted">Nothing unfinished</p>

  let angle = 0
  const arcs = visible.map((s) => {
    const start = angle
    angle += (s.total / total) * Math.PI * 2
    return { ...s, d: arc(start, angle) }
  })
  const current = visible.find((s) => s.key === active)

  const move = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top })
  }

  return (
    <div className="donut-wrap">
      <div className="donut" onMouseMove={move} onMouseLeave={() => (setActive(null), setTip(null))}>
        <svg viewBox="0 0 200 200" role="img" aria-label="Unfinished tasks by category">
          {arcs.map((s) => (
            <path
              key={s.key}
              d={s.d}
              fill={s.color}
              className={cx('donut-slice', active && active !== s.key && 'dim')}
              onMouseEnter={() => setActive(s.key)}
            />
          ))}
        </svg>
        <div className="donut-center" aria-hidden>
          <span className="donut-total">{current ? current.total : total}</span>
          <span className="muted small">{current ? current.name : 'unfinished'}</span>
        </div>
        {current && tip && (
          <div className="tooltip donut-tip" style={{ left: tip.x, top: tip.y }}>
            <strong>{current.name}</strong>
            {(['open', 'in_progress', 'review'] as Status[]).map((s) => (
              <span key={s}>
                <StatusIcon status={s} size={12} /> {statusLabel(s)} <b>{s === 'open' ? current.open : s === 'in_progress' ? current.inProgress : current.review}</b>
              </span>
            ))}
          </div>
        )}
      </div>

      <ul className="donut-legend">
        {visible.map((s) => (
          <li key={s.key} className={cx(active && active !== s.key && 'dim')} onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}>
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.href ? (
              <Link to={s.href} className="truncate">
                {s.name}
              </Link>
            ) : (
              <span className="truncate">{s.name}</span>
            )}
            <span className="num muted">{s.total}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StackBar({ parts, total, scale }: { parts: { status: Status; n: number }[]; total: number; scale?: number }) {
  return (
    <div className="sbar" style={scale !== undefined ? { width: `${scale * 100}%` } : undefined}>
      {total === 0 ? (
        <span className="sbar-empty" />
      ) : (
        parts
          .filter((p) => p.n > 0)
          .map((p) => <span key={p.status} className={`sbar-seg seg-${p.status}`} style={{ flexGrow: p.n }} title={`${statusLabel(p.status)}: ${p.n}`} />)
      )}
    </div>
  )
}

function CategoryProgress({ c }: { c: CategoryStats }) {
  return (
    <div className="cat-progress">
      <div className="cat-progress-head">
        <Link to={`/tasks/c/${c.id}`} className="cat-name truncate">
          {c.name}
        </Link>
        <span className="muted small num">
          {c.done}/{c.total}
        </span>
      </div>
      <StackBar
        total={c.total}
        parts={[
          { status: 'done', n: c.done },
          { status: 'review', n: c.review },
          { status: 'in_progress', n: c.inProgress },
          { status: 'open', n: c.open },
        ]}
      />
      {c.sections.some((s) => s.id !== null) && (
        <ul className="section-progress">
          {c.sections.map((s) => (
            <li key={s.id ?? 'top'}>
              <span className="truncate">{s.title ?? 'No section'}</span>
              <span className="mini-bar">
                <span style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} />
              </span>
              <span className="muted small num">
                {s.done}/{s.total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StaleList({ stale }: { stale: Analytics['stale'] }) {
  const { userById, categoryById } = useData()
  return (
    <ul className="task-list">
      {stale.map((t) => (
        <li key={t.id}>
          <Link className="task-row" to={`/tasks?status=all&task=${t.id}`}>
            <span className="task-id">#{t.id}</span>
            <StatusIcon status={t.status} />
            <span className="task-title truncate">{t.title}</span>
            <span className="badge task-category">{categoryById.get(t.categoryId)?.name}</span>
            <span className="idle">{t.idleDays} d</span>
            <span className="task-assignee">
              {t.assigneeId ? <Avatar user={userById.get(t.assigneeId)} size={22} /> : <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} />}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Workload({ people, days }: { people: NonNullable<Analytics['people']>; days: number }) {
  const { userById } = useData()
  const maxLoad = Math.max(1, ...people.map((p) => p.inProgress + p.review + p.open))
  return (
    <ul className="workload">
      {people.map((p) => {
        const load = p.inProgress + p.review + p.open
        return (
          <li key={p.userId}>
            <span className="user-chip">
              <Avatar user={userById.get(p.userId)} size={24} />
              <span className="truncate">{displayName(userById.get(p.userId))}</span>
            </span>
            <span className="workload-bar">
              <StackBar
                total={load}
                scale={load / maxLoad}
                parts={[
                  { status: 'in_progress', n: p.inProgress },
                  { status: 'review', n: p.review },
                  { status: 'open', n: p.open },
                ]}
              />
              <span className="small num">{load}</span>
            </span>
            <span className="muted small num workload-closed" title={`Finished in the last ${days} days`}>
              ✓ {p.closed}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
