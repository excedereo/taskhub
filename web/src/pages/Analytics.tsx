import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChartColumn, Hourglass, TriangleAlert, Users } from 'lucide-react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import { STATUSES, type Status } from '../types.ts'
import { cx, displayName } from '../util.ts'
import { Avatar, Empty, PageHeader, StatusIcon } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'

type Bucket = { start: number; created: number; closed: number }

type Analytics = {
  days: number
  staleThresholds: { inProgress: number; review: number }
  overview: { open: number; inProgress: number; review: number; done: number; closed: number; closedPrev: number; created: number; createdPrev: number }
  categories: {
    id: number
    name: string
    total: number
    done: number
    inProgress: number
    review: number
    open: number
    sections: { id: number | null; title: string | null; total: number; done: number }[]
    forecast: { remaining: number; perWeek: number; weeks: number | null }
  }[]
  throughput: { unit: 'day' | 'week'; buckets: Bucket[] }
  stale: { id: number; title: string; status: Status; assigneeId: number | null; categoryId: number; idleDays: number }[]
  people?: { userId: number; inProgress: number; review: number; open: number; closed: number }[]
  cycle?: { count: number; skipped: number; medianMs: number | null; averageMs: number | null; byCategory: { categoryId: number; count: number; medianMs: number | null }[] }
}

const PERIODS = [7, 30, 90] as const
const PERIOD_KEY = 'taskhub.analytics-period'

function readPeriod() {
  try {
    const v = Number(localStorage.getItem(PERIOD_KEY))
    return (PERIODS as readonly number[]).includes(v) ? v : 30
  } catch {
    return 30
  }
}

const dayFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })

function formatDuration(ms: number | null) {
  if (ms === null) return '—'
  const h = ms / 3600000
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} d`
}

function forecastText(f: Analytics['categories'][number]['forecast']) {
  if (f.remaining === 0) return 'All done'
  if (f.weeks === null) return 'No tasks finished in the last 4 weeks, so no forecast yet'
  const pace = `${f.perWeek % 1 ? f.perWeek.toFixed(1) : f.perWeek} per week`
  if (f.weeks < 1) return `≈ less than a week left at ${pace}`
  const weeks = Math.round(f.weeks)
  return `≈ ${weeks} week${weeks === 1 ? '' : 's'} left at ${pace}`
}

/** About four gridlines on whole-number steps of 1, 2 or 5 times a power of ten. */
function niceScale(value: number) {
  const raw = Math.max(1, value) / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow)
  const max = Math.max(step, Math.ceil(value / step) * step)
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) }
}

export function AnalyticsPage() {
  const { can } = useData()
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
    api.get<Analytics>(`/analytics?days=${days}&tz=${new Date().getTimezoneOffset()}`).then(setData).catch(toast.error)
  }, [days, toast])

  const periodLabel = `${days} days`

  return (
    <div className="page analytics">
      <PageHeader
        title="Analytics"
        description="Archived tasks are not counted."
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
          <div className="skeleton-row" style={{ height: 240 }} />
        </div>
      ) : (
        <>
          <section className="tiles">
            <Tile label="Open" value={data.overview.open} />
            <Tile label="In progress" value={data.overview.inProgress} />
            <Tile label="In review" value={data.overview.review} />
            <Tile label={`Finished · ${periodLabel}`} value={data.overview.closed} prev={data.overview.closedPrev} />
            <Tile label={`Created · ${periodLabel}`} value={data.overview.created} prev={data.overview.createdPrev} />
          </section>

          <section className="card dash-card">
            <div className="dash-head">
              <h2>Pace</h2>
              <span className="muted small">Tasks created and finished per {data.throughput.unit}</span>
            </div>
            <Throughput buckets={data.throughput.buckets} unit={data.throughput.unit} />
          </section>

          <section className="card dash-card">
            <div className="dash-head">
              <h2>Progress by category</h2>
              <StatusLegend />
            </div>
            {data.categories.length === 0 ? (
              <p className="muted">No categories yet.</p>
            ) : (
              <div className="progress-list">
                {data.categories.map((c) => (
                  <CategoryProgress key={c.id} c={c} />
                ))}
              </div>
            )}
          </section>

          <section className="card dash-card">
            <div className="dash-head">
              <h2>
                <TriangleAlert size={15} /> Stuck
              </h2>
              <span className="muted small">
                In progress without changes for {data.staleThresholds.inProgress}+ days, in review for {data.staleThresholds.review}+ days
              </span>
            </div>
            <StaleList stale={data.stale} />
          </section>

          {data.people && (
            <section className="card dash-card">
              <div className="dash-head">
                <h2>
                  <Users size={15} /> Workload
                </h2>
                <span className="muted small">Assigned now · finished in {periodLabel}</span>
              </div>
              <Workload people={data.people} />
            </section>
          )}

          {data.cycle && (
            <section className="card dash-card">
              <div className="dash-head">
                <h2>
                  <Hourglass size={15} /> Time to finish
                </h2>
                <span className="muted small">From the first move to In progress until Done, tasks finished in {periodLabel}</span>
              </div>
              <Cycle cycle={data.cycle} />
            </section>
          )}

          {!can('view_audit') && <p className="muted small center">Workload and time to finish are visible to people with the View audit log permission.</p>}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, prev }: { label: string; value: number; prev?: number }) {
  const delta = prev === undefined ? null : value - prev
  return (
    <div className="stat">
      <span className="muted small">{label}</span>
      <span className="stat-value">{value}</span>
      {delta !== null && (
        <span className="muted small">{delta === 0 ? 'same as the period before' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} vs the period before`}</span>
      )}
    </div>
  )
}

function Throughput({ buckets, unit }: { buckets: Bucket[]; unit: 'day' | 'week' }) {
  const [hover, setHover] = useState<number | null>(null)
  const { max, ticks } = niceScale(Math.max(...buckets.flatMap((b) => [b.created, b.closed])))
  const labelEvery = Math.ceil(buckets.length / 8)
  const label = (b: Bucket) => (unit === 'week' ? `Week of ${dayFmt.format(b.start)}` : dayFmt.format(b.start))
  const totals = useMemo(() => buckets.reduce((a, b) => ({ created: a.created + b.created, closed: a.closed + b.closed }), { created: 0, closed: 0 }), [buckets])

  return (
    <>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-swatch series-1" /> Created <strong>{totals.created}</strong>
        </span>
        <span className="legend-item">
          <span className="legend-swatch series-2" /> Finished <strong>{totals.closed}</strong>
        </span>
      </div>
      <div className="tp" onMouseLeave={() => setHover(null)}>
        <div className="tp-plot">
          {ticks.map((t) => (
            <div key={t} className={cx('tp-grid', t === 0 && 'tp-base')} style={{ bottom: `${(t / max) * 100}%` }}>
              <span className="tp-tick">{t}</span>
            </div>
          ))}
          <div className="tp-groups">
            {buckets.map((b, i) => (
              <div key={b.start} className={cx('tp-group', hover === i && 'hover')} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${label(b)}: ${b.created} created, ${b.closed} finished`}>
                <span className="tp-bar series-1" style={{ height: `${(b.created / max) * 100}%` }} />
                <span className="tp-bar series-2" style={{ height: `${(b.closed / max) * 100}%` }} />
                {hover === i && (
                  <div className={cx('tooltip', i > buckets.length * 0.66 && 'tooltip-left')}>
                    <strong>{label(b)}</strong>
                    <span>
                      <span className="legend-swatch series-1" /> Created <b>{b.created}</b>
                    </span>
                    <span>
                      <span className="legend-swatch series-2" /> Finished <b>{b.closed}</b>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="tp-x">
          {buckets.map((b, i) => (
            <span key={b.start}>{i % labelEvery === 0 ? dayFmt.format(b.start) : ''}</span>
          ))}
        </div>
      </div>
      <details className="table-view">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th>{unit === 'week' ? 'Week of' : 'Day'}</th>
              <th>Created</th>
              <th>Finished</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start}>
                <td>{dayFmt.format(b.start)}</td>
                <td>{b.created}</td>
                <td>{b.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}

const ORDER: Status[] = ['done', 'review', 'in_progress', 'open']

function StatusLegend() {
  return (
    <div className="legend">
      {ORDER.map((s) => (
        <span key={s} className="legend-item">
          <StatusIcon status={s} size={12} /> {STATUSES.find((x) => x.key === s)?.label}
        </span>
      ))}
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
          .map((p) => <span key={p.status} className={`sbar-seg seg-${p.status}`} style={{ flexGrow: p.n }} title={`${STATUSES.find((s) => s.key === p.status)?.label}: ${p.n}`} />)
      )}
    </div>
  )
}

function CategoryProgress({ c }: { c: Analytics['categories'][number] }) {
  const pct = c.total ? Math.round((c.done / c.total) * 100) : 0
  return (
    <div className="cat-progress">
      <div className="cat-progress-head">
        <Link to={`/tasks/c/${c.id}`} className="cat-name">
          {c.name}
        </Link>
        <span className="muted small">
          {c.done}/{c.total} · {pct}%
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
      <p className="muted small">{forecastText(c.forecast)}</p>
      {c.sections.some((s) => s.id !== null) && (
        <ul className="section-progress">
          {c.sections.map((s) => (
            <li key={s.id ?? 'top'}>
              <span className="truncate">{s.title ?? 'Before the first section'}</span>
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
  if (!stale.length) return <p className="muted">Nothing is stuck. Nice.</p>
  return (
    <ul className="task-list">
      {stale.map((t) => (
        <li key={t.id}>
          <Link className="task-row" to={`/tasks?status=all&task=${t.id}`}>
            <span className="task-id">#{t.id}</span>
            <StatusIcon status={t.status} />
            <span className="task-title truncate">{t.title}</span>
            <span className="badge task-category">{categoryById.get(t.categoryId)?.name}</span>
            <span className="idle">{t.idleDays} days idle</span>
            <span className="task-assignee">
              {t.assigneeId ? <Avatar user={userById.get(t.assigneeId)} size={22} /> : <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} />}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Workload({ people }: { people: NonNullable<Analytics['people']> }) {
  const { userById } = useData()
  if (!people.length) return <p className="muted">Nobody has tasks assigned yet.</p>
  const maxLoad = Math.max(1, ...people.map((p) => p.inProgress + p.review + p.open))
  return (
    <>
      <div className="legend">
        {(['in_progress', 'review', 'open'] as Status[]).map((s) => (
          <span key={s} className="legend-item">
            <StatusIcon status={s} size={12} /> {STATUSES.find((x) => x.key === s)?.label}
          </span>
        ))}
      </div>
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
              <span className="muted small num workload-closed">{p.closed} finished</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function Cycle({ cycle }: { cycle: NonNullable<Analytics['cycle']> }) {
  const { categoryById } = useData()
  if (!cycle.count) {
    return (
      <Empty icon={<ChartColumn size={20} />} title="Not enough data yet">
        {cycle.skipped ? `${cycle.skipped} task(s) were closed the moment they were created, so they are left out.` : 'Finish a few tasks and this fills in.'}
      </Empty>
    )
  }
  return (
    <>
      <div className="tiles tiles-3">
        <div className="stat">
          <span className="muted small">Median</span>
          <span className="stat-value">{formatDuration(cycle.medianMs)}</span>
        </div>
        <div className="stat">
          <span className="muted small">Average</span>
          <span className="stat-value">{formatDuration(cycle.averageMs)}</span>
        </div>
        <div className="stat">
          <span className="muted small">Tasks measured</span>
          <span className="stat-value">{cycle.count}</span>
        </div>
      </div>
      {cycle.byCategory.length > 1 && (
        <ul className="section-progress">
          {cycle.byCategory.map((c) => (
            <li key={c.categoryId}>
              <span className="truncate">{categoryById.get(c.categoryId)?.name}</span>
              <span className="muted small num">{c.count} tasks</span>
              <span className="num">{formatDuration(c.medianMs)}</span>
            </li>
          ))}
        </ul>
      )}
      {cycle.skipped > 0 && <p className="muted small">{cycle.skipped} task(s) closed the moment they were created are left out.</p>}
    </>
  )
}
