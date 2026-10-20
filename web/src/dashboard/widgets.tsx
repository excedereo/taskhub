import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../store.tsx'
import { useLooks } from '../prefs.ts'
import type { Status } from '../types.ts'
import { cx, displayName, formatDate } from '../util.ts'
import { Avatar, DueBadge, StatusIcon } from '../components/ui.tsx'
import { DAY, dueEnd, num, str, type DashData, type DashTask, type Widget } from './model.ts'

type Props = { widget: Widget; data: DashData; days: number }
type Counts = Record<number, number>

const TYPE_RANK = { done: 0, active: 1, todo: 2 } as const
const MAX_SLICES = 8

/** Shared helpers over the dashboard data, scoped by a widget's category and label settings. */
function useTasks(widget: Widget, data: DashData) {
  const { statusById } = useData()
  return useMemo(() => {
    const categoryId = num(widget.config.categoryId)
    const labelId = num(widget.config.labelId)
    const typeOf = (t: DashTask) => statusById.get(t.statusId)?.type
    const scoped = data.tasks.filter((t) => (categoryId === null || t.categoryId === categoryId) && (labelId === null || t.labelIds.includes(labelId)))
    const current = scoped.filter((t) => !t.archivedAt)
    return { scoped, current, open: current.filter((t) => typeOf(t) !== 'done'), typeOf }
  }, [widget.config.categoryId, widget.config.labelId, data, statusById])
}

const byStatus = (tasks: DashTask[]) => {
  const out: Counts = {}
  for (const t of tasks) out[t.statusId] = (out[t.statusId] ?? 0) + 1
  return out
}

/* ---------- Number ---------- */

export function NumberWidget({ widget, data, days }: Props) {
  const { scoped, current, open, typeOf } = useTasks(widget, data)
  const metric = str(widget.config.metric) || 'open'
  const now = data.now
  const inWindow = (ts: number | null, from: number, to: number) => ts !== null && ts >= from && ts < to
  const periods = (pick: (t: DashTask) => number | null) => [
    scoped.filter((t) => inWindow(pick(t), now - days * DAY, now + 1)).length,
    scoped.filter((t) => inWindow(pick(t), now - 2 * days * DAY, now - days * DAY)).length,
  ]
  let value = 0
  let prev: number | undefined
  if (metric === 'open') value = open.length
  else if (metric === 'todo') value = current.filter((t) => typeOf(t) === 'todo').length
  else if (metric === 'active') value = current.filter((t) => typeOf(t) === 'active').length
  else if (metric === 'overdue') value = open.filter((t) => t.dueDate && dueEnd(t.dueDate) < now).length
  else if (metric === 'unassigned') value = open.filter((t) => !t.assigneeId).length
  else if (metric === 'closed') [value, prev] = periods((t) => t.closedAt)
  else if (metric === 'created') [value, prev] = periods((t) => t.createdAt)
  const delta = prev === undefined ? 0 : value - prev
  return (
    <div className="w-number">
      <span className="stat-value">
        {value}
        {delta !== 0 && (
          <span className="stat-delta" title={`${prev} in the ${days} days before`}>
            {delta > 0 ? `+${delta}` : `−${-delta}`}
          </span>
        )}
      </span>
      {(metric === 'closed' || metric === 'created') && <span className="muted small">last {days} days</span>}
    </div>
  )
}

/* ---------- Countdown ---------- */

const pad = (n: number) => String(n).padStart(2, '0')

export function CountdownWidget({ widget, data }: Props) {
  const { open } = useTasks({ ...widget, config: { ...widget.config, labelId: null } }, data)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const target = str(widget.config.target) || 'deadline'
  let when: number | null = null
  let label: ReactNode = null
  if (target === 'date') {
    const raw = str(widget.config.date)
    const ts = raw ? new Date(raw).getTime() : NaN
    if (Number.isFinite(ts)) when = ts
  } else if (target === 'task') {
    const task = data.tasks.find((t) => t.id === num(widget.config.taskId))
    if (task?.dueDate) {
      when = dueEnd(task.dueDate)
      label = <Link to={`/tasks?status=all&task=${task.id}`}>#{task.id} {task.title}</Link>
    } else label = task ? `#${task.id} has no due date` : 'Pick a task in the widget settings'
  } else {
    const next = open.filter((t) => t.dueDate && dueEnd(t.dueDate) >= now).sort((a, b) => dueEnd(a.dueDate!) - dueEnd(b.dueDate!))[0]
    if (next) {
      when = dueEnd(next.dueDate!)
      label = <Link to={`/tasks?status=all&task=${next.id}`}>#{next.id} {next.title}</Link>
    } else label = 'No upcoming deadlines'
  }

  if (when === null) return <p className="muted w-empty">{label ?? 'Set a date in the widget settings'}</p>
  const left = when - now
  const abs = Math.abs(left)
  const d = Math.floor(abs / DAY)
  const h = Math.floor((abs % DAY) / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  const s = Math.floor((abs % 60_000) / 1000)
  return (
    <div className="w-countdown">
      <span className={cx('w-countdown-time', left < 0 && 'is-past')}>
        {left < 0 && <span className="w-countdown-tag">passed</span>}
        {d > 0 && (
          <>
            {d}
            <small>d</small>{' '}
          </>
        )}
        {pad(h)}:{pad(m)}:{pad(s)}
      </span>
      <span className="muted small truncate">
        {label ? <>{label} · </> : null}
        {new Date(when).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}
      </span>
    </div>
  )
}

/* ---------- Deadlines ---------- */

export function DeadlinesWidget({ widget, data }: Props) {
  const { open } = useTasks(widget, data)
  const { categoryById } = useData()
  const limit = num(widget.config.limit) ?? 8
  const list = open.filter((t) => t.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)).slice(0, limit)
  if (!list.length) return <p className="muted w-empty">Nothing has a due date</p>
  return (
    <ul className="w-list">
      {list.map((t) => (
        <li key={t.id}>
          <Link className="w-list-row" to={`/tasks?status=all&task=${t.id}`}>
            <StatusIcon id={t.statusId} />
            <span className="truncate grow">{t.title}</span>
            <span className="muted small truncate w-list-cat">{categoryById.get(t.categoryId)?.name}</span>
            <DueBadge due={t.dueDate} done={false} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Breakdown: ring or bars ---------- */

type Slice = { key: string; name: string; color: string; value: number; href?: string; counts?: Counts }

function arc(start: number, end: number, R = 80, W = 30): string {
  const point = (a: number, r: number) => [100 + r * Math.sin(a), 100 - r * Math.cos(a)]
  const outer = R + W / 2
  const inner = R - W / 2
  if (end - start >= Math.PI * 2 - 1e-6) return `${arc(0, Math.PI)} ${arc(Math.PI, Math.PI * 2)}`
  const large = end - start > Math.PI ? 1 : 0
  const [x1, y1] = point(start, outer)
  const [x2, y2] = point(end, outer)
  const [x3, y3] = point(end, inner)
  const [x4, y4] = point(start, inner)
  return `M${x1} ${y1} A${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`
}

/** At most eight slices; anything past the seventh folds into "Other", never into a generated colour. */
function fold(slices: Slice[]): Slice[] {
  if (slices.length <= MAX_SLICES) return slices
  const rest = slices.slice(MAX_SLICES - 1)
  return [...slices.slice(0, MAX_SLICES - 1), { key: 'other', name: `Other (${rest.length})`, color: 'var(--cat-other)', value: rest.reduce((a, s) => a + s.value, 0) }]
}

function useSlices(widget: Widget, data: DashData): Slice[] {
  const { open, current } = useTasks(widget, data)
  const { categories, statuses, priorities, users, labels } = useData()
  const looks = useLooks()
  const tasks = str(widget.config.scope) === 'all' ? current : open
  const by = str(widget.config.by) || 'status'
  const count = (pick: (t: DashTask) => boolean) => tasks.filter(pick).length

  // Colour follows the entity, never its size: categories by their place in the menu, people by their place in the team.
  if (by === 'category') {
    const order = categories.filter((c) => !c.archived).sort((a, b) => a.position - b.position || a.id - b.id)
    return fold(order.map((c, i) => ({ key: `c${c.id}`, name: c.name, color: `var(--cat-${(i % MAX_SLICES) + 1})`, value: count((t) => t.categoryId === c.id), href: `/tasks/c/${c.id}` })))
  }
  if (by === 'priority') return priorities.map((p) => ({ key: `p${p.id}`, name: p.name, color: looks.priorityColor(p), value: count((t) => t.priorityId === p.id) }))
  if (by === 'assignee') {
    const people = users.filter((u) => u.status !== 'invited')
    const slices = people.map((u, i) => ({ key: `u${u.id}`, name: displayName(u), color: `var(--cat-${(i % MAX_SLICES) + 1})`, value: count((t) => t.assigneeId === u.id) }))
    return [...fold(slices.filter((s) => s.value > 0)), { key: 'none', name: 'Unassigned', color: 'var(--cat-other)', value: count((t) => !t.assigneeId) }]
  }
  if (by === 'label') return [...labels.map((l) => ({ key: `l${l.id}`, name: l.name, color: l.color, value: count((t) => t.labelIds.includes(l.id)) })), { key: 'none', name: 'No label', color: 'var(--cat-other)', value: count((t) => !t.labelIds.length) }]
  return statuses.map((s) => ({ key: `s${s.id}`, name: s.name, color: looks.statusColor(s), value: count((t) => t.statusId === s.id) }))
}

export function BreakdownWidget({ widget, data }: Props) {
  const slices = useSlices(widget, data).filter((s) => s.value > 0)
  const [active, setActive] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const total = slices.reduce((a, s) => a + s.value, 0)
  if (!total) return <p className="muted w-empty">Nothing to count</p>

  if (str(widget.config.chart) === 'bars') {
    const max = Math.max(...slices.map((s) => s.value))
    return (
      <ul className="w-bars">
        {slices.map((s) => (
          <li key={s.key} title={`${s.name}: ${s.value}`}>
            {s.href ? (
              <Link to={s.href} className="truncate">
                {s.name}
              </Link>
            ) : (
              <span className="truncate">{s.name}</span>
            )}
            <span className="w-bar-track">
              <span className="w-bar" style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />
            </span>
            <span className="num small">{s.value}</span>
          </li>
        ))}
      </ul>
    )
  }

  let angle = 0
  const arcs = slices.map((s) => {
    const start = angle
    angle += (s.value / total) * Math.PI * 2
    return { ...s, d: arc(start, angle) }
  })
  const current = slices.find((s) => s.key === active)
  const move = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top })
  }
  return (
    <div className="donut-wrap">
      <div className="donut" onMouseMove={move} onMouseLeave={() => (setActive(null), setTip(null))}>
        <svg viewBox="0 0 200 200" role="img" aria-label={`${total} tasks`}>
          {arcs.map((s) => (
            <path key={s.key} d={s.d} fill={s.color} className={cx('donut-slice', active && active !== s.key && 'dim')} onMouseEnter={() => setActive(s.key)} />
          ))}
        </svg>
        <div className="donut-center" aria-hidden>
          <span className="donut-total">{current ? current.value : total}</span>
          <span className="muted small">{current ? current.name : 'tasks'}</span>
        </div>
        {current && tip && (
          <div className="tooltip donut-tip" style={{ left: tip.x, top: tip.y }}>
            <strong>{current.name}</strong>
            <span>
              Tasks <b>{current.value}</b>
            </span>
            <span>
              Share <b>{Math.round((current.value / total) * 100)}%</b>
            </span>
          </div>
        )}
      </div>
      <ul className="donut-legend">
        {slices.map((s) => (
          <li key={s.key} className={cx(active && active !== s.key && 'dim')} onMouseEnter={() => setActive(s.key)} onMouseLeave={() => setActive(null)}>
            <span className="legend-swatch" style={{ background: s.color }} />
            {s.href ? (
              <Link to={s.href} className="truncate">
                {s.name}
              </Link>
            ) : (
              <span className="truncate">{s.name}</span>
            )}
            <span className="num muted">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Progress ---------- */

function StackBar({ counts, scale }: { counts: Counts; scale?: number }) {
  const { statuses } = useData()
  const looks = useLooks()
  const ordered = [...statuses].sort((a: Status, b: Status) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.position - b.position)
  const parts = ordered.map((s) => ({ s, n: counts[s.id] ?? 0 })).filter((p) => p.n > 0)
  return (
    <div className="sbar" style={scale !== undefined ? { width: `${scale * 100}%` } : undefined}>
      {parts.length === 0 ? <span className="sbar-empty" /> : parts.map(({ s, n }) => <span key={s.id} className="sbar-seg" style={{ flexGrow: n, background: looks.statusColor(s) }} title={`${s.name}: ${n}`} />)}
    </div>
  )
}

export function ProgressWidget({ widget, data }: Props) {
  const { categories } = useData()
  const { current, typeOf } = useTasks({ ...widget, config: { ...widget.config, labelId: null } }, data)
  const only = num(widget.config.categoryId)
  const list = categories.filter((c) => !c.archived && (only === null || c.id === only)).sort((a, b) => a.position - b.position || a.id - b.id)
  const rows = list.map((c) => {
    const top = current.filter((t) => t.categoryId === c.id && !t.parentId)
    const sections: { key: string; title: string | null; total: number; done: number }[] = [{ key: 'top', title: null, total: 0, done: 0 }]
    const items = [
      ...data.sections.filter((s) => s.categoryId === c.id).map((s) => ({ pos: s.position, section: s })),
      ...top.map((t) => ({ pos: t.position, task: t })),
    ].sort((a, b) => a.pos - b.pos)
    for (const item of items) {
      if ('section' in item) sections.push({ key: `s${item.section.id}`, title: item.section.title, total: 0, done: 0 })
      else {
        const s = sections[sections.length - 1]
        s.total++
        if (typeOf(item.task) === 'done') s.done++
      }
    }
    return { c, top, done: top.filter((t) => typeOf(t) === 'done').length, sections: sections.filter((s) => s.title !== null || s.total > 0) }
  })
  if (!rows.length) return <p className="muted w-empty">No categories yet</p>
  return (
    <div className="progress-list">
      {rows.map(({ c, top, done, sections }) => (
        <div key={c.id} className="cat-progress">
          <div className="cat-progress-head">
            <Link to={`/tasks/c/${c.id}`} className="cat-name truncate">
              {c.name}
            </Link>
            <span className="muted small num">
              {done}/{top.length}
            </span>
          </div>
          <StackBar counts={byStatus(top)} />
          {sections.some((s) => s.title !== null) && (
            <ul className="section-progress">
              {sections.map((s) => (
                <li key={s.key}>
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
      ))}
    </div>
  )
}

/* ---------- Timeline: created and finished ---------- */

const startOfDay = (ts: number) => {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function TimelineWidget({ widget, data, days }: Props) {
  const { scoped } = useTasks(widget, data)
  const [hover, setHover] = useState<number | null>(null)
  // Long periods are counted by week, so a quiet day does not make the line jagged.
  const step = days > 30 ? 7 : 1
  const buckets = Math.ceil(days / step)
  const end = startOfDay(data.now) + DAY
  const from = end - buckets * step * DAY
  const created = new Array(buckets).fill(0)
  const closed = new Array(buckets).fill(0)
  for (const t of scoped) {
    if (t.createdAt >= from && t.createdAt < end) created[Math.floor((t.createdAt - from) / (step * DAY))]++
    if (t.closedAt !== null && t.closedAt >= from && t.closedAt < end) closed[Math.floor((t.closedAt - from) / (step * DAY))]++
  }
  const max = Math.max(1, ...created, ...closed)
  const W = 800
  const H = 180
  const PADL = 32
  const PADB = 22
  const x = (i: number) => PADL + (buckets === 1 ? 0 : (i / (buckets - 1)) * (W - PADL - 8))
  const y = (v: number) => 8 + (1 - v / max) * (H - PADB - 8)
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ')
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i)
  const label = (i: number) => new Date(from + i * step * DAY).toLocaleDateString('en', { month: 'short', day: 'numeric' })
  const series = [
    { name: 'Created', vals: created, color: 'var(--series-1)' },
    { name: 'Finished', vals: closed, color: 'var(--series-2)' },
  ]

  return (
    <div className="w-timeline">
      <div className="w-legend">
        {series.map((s) => (
          <span key={s.name}>
            <span className="legend-swatch" style={{ background: s.color }} /> {s.name} <b className="num">{s.vals.reduce((a, b) => a + b, 0)}</b>
          </span>
        ))}
        <span className="muted small">{step === 7 ? 'per week' : 'per day'}</span>
      </div>
      <div className="w-chart" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tasks created and finished over time">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PADL} x2={W - 8} y1={y(v)} y2={y(v)} className="w-grid" />
              <text x={PADL - 8} y={y(v) + 4} textAnchor="end" className="w-axis">
                {v}
              </text>
            </g>
          ))}
          {[0, Math.floor((buckets - 1) / 2), buckets - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === buckets - 1 ? 'end' : 'middle'} className="w-axis">
              {label(i)}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={8} y2={H - PADB} className="w-crosshair" />}
          {series.map((s) => (
            <path key={s.name} d={line(s.vals)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {hover !== null && series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.vals[hover])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
          {/* Wide invisible columns make hovering easy. */}
          {created.map((_, i) => (
            <rect key={i} x={x(i) - (W - PADL) / buckets / 2} y={0} width={(W - PADL) / buckets} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover !== null && (
          <div className="tooltip w-chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <strong>{step === 7 ? `Week of ${label(hover)}` : label(hover)}</strong>
            {series.map((s) => (
              <span key={s.name}>
                <span className="legend-swatch" style={{ background: s.color }} /> {s.name} <b>{s.vals[hover]}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------- Honeycomb ---------- */

/** Four steps of one warm hue over the surface: more unfinished work, deeper colour. */
const heat = (level: number) => (level === 0 ? 'var(--hover)' : `color-mix(in srgb, var(--cat-2) ${[0, 28, 50, 72, 100][level]}%, var(--surface))`)
const levelOf = (v: number, max: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)))

export function HoneycombWidget({ widget, data }: Props) {
  const { categories } = useData()
  const { open } = useTasks({ ...widget, config: {} }, data)
  const cells = categories
    .filter((c) => !c.archived)
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((c) => ({ c, n: open.filter((t) => t.categoryId === c.id).length }))
  if (!cells.length) return <p className="muted w-empty">No categories yet</p>
  const max = Math.max(1, ...cells.map((x) => x.n))
  const R = 46
  const w = Math.sqrt(3) * R
  const perRow = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(cells.length * 1.6))))
  const rows = Math.ceil(cells.length / perRow)
  const width = perRow * w + w / 2 + 4
  const height = rows * R * 1.5 + R / 2 + 4
  const hex = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 3) * k - Math.PI / 2
      return `${cx + (R - 2) * Math.cos(a)},${cy + (R - 2) * Math.sin(a)}`
    }).join(' ')
  return (
    <div className="w-honeycomb">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Unfinished tasks per category">
        {cells.map(({ c, n }, i) => {
          const row = Math.floor(i / perRow)
          const hx = (i % perRow) * w + w / 2 + (row % 2 ? w / 2 : 0) + 2
          const hy = row * R * 1.5 + R + 2
          const level = levelOf(n, max)
          return (
            <Link key={c.id} to={`/tasks/c/${c.id}`}>
              <g className="w-hex">
                <title>{`${c.name}: ${n} unfinished`}</title>
                <polygon points={hex(hx, hy)} fill={heat(level)} />
                <text x={hx} y={hy - 2} textAnchor="middle" className={level >= 3 ? 'w-hex-name on-strong' : 'w-hex-name'}>
                  {c.name.length > 11 ? `${c.name.slice(0, 10)}…` : c.name}
                </text>
                <text x={hx} y={hy + 16} textAnchor="middle" className={level >= 3 ? 'w-hex-num on-strong' : 'w-hex-num'}>
                  {n}
                </text>
              </g>
            </Link>
          )
        })}
      </svg>
      <HeatLegend />
    </div>
  )
}

function HeatLegend() {
  return (
    <div className="w-heat-legend muted small">
      Less
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} style={{ background: heat(l) }} />
      ))}
      More
    </div>
  )
}

/* ---------- Activity calendar ---------- */

export function ActivityWidget({ data }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const weeks = 26
  const today = startOfDay(data.now)
  // Columns are weeks starting on Monday; the last column ends with today.
  const dow = (new Date(today).getDay() + 6) % 7
  const first = today - (weeks - 1) * 7 * DAY - dow * DAY
  const counts = new Map<number, number>()
  for (const ts of data.activity) {
    const d = startOfDay(ts)
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  const max = Math.max(1, ...counts.values())
  const C = 13
  const G = 3
  const cells: { x: number; y: number; day: number; n: number }[] = []
  for (let w = 0; w < weeks; w++)
    for (let d = 0; d < 7; d++) {
      const day = first + (w * 7 + d) * DAY
      if (day > today) continue
      cells.push({ x: w * (C + G), y: d * (C + G), day, n: counts.get(day) ?? 0 })
    }
  const total = cells.reduce((a, c) => a + c.n, 0)
  return (
    <div className="w-activity" onMouseLeave={() => setTip(null)}>
      <div className="w-activity-scroll">
        <svg width={weeks * (C + G)} height={7 * (C + G)} role="img" aria-label={`${total} changes in the last ${weeks} weeks`}>
          {cells.map((c) => (
            <rect
              key={c.day}
              x={c.x}
              y={c.y}
              width={C}
              height={C}
              rx={3}
              fill={heat(levelOf(c.n, max))}
              onMouseEnter={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                setTip({ x: c.x + C / 2 + box.left - (e.currentTarget.closest('.w-activity') as HTMLElement).getBoundingClientRect().left, y: c.y, text: `${c.n} change${c.n === 1 ? '' : 's'} · ${new Date(c.day).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}` })
              }}
            />
          ))}
        </svg>
      </div>
      {tip && (
        <div className="tooltip w-activity-tip" style={{ left: tip.x, top: tip.y }}>
          <span>{tip.text}</span>
        </div>
      )}
      <div className="w-activity-foot">
        <span className="muted small">
          {total} changes in the last {weeks} weeks
        </span>
        <HeatLegend />
      </div>
    </div>
  )
}

/* ---------- Stuck and workload ---------- */

export function StuckWidget({ widget, data }: Props) {
  const { open, typeOf } = useTasks(widget, data)
  const { userById, categoryById } = useData()
  const days = num(widget.config.days) ?? 7
  const stale = open
    .filter((t) => typeOf(t) === 'active' && t.updatedAt < data.now - days * DAY)
    .map((t) => ({ t, idle: Math.floor((data.now - t.updatedAt) / DAY) }))
    .sort((a, b) => b.idle - a.idle)
    .slice(0, 25)
  if (!stale.length) return <p className="muted w-empty">Nothing in progress has been left for {days}+ days</p>
  return (
    <ul className="task-list">
      {stale.map(({ t, idle }) => (
        <li key={t.id}>
          <Link className="task-row" to={`/tasks?status=all&task=${t.id}`}>
            <span className="task-id">#{t.id}</span>
            <StatusIcon id={t.statusId} />
            <span className="task-title truncate">{t.title}</span>
            <span className="badge task-category">{categoryById.get(t.categoryId)?.name}</span>
            <span className="idle" title={`Last changed ${formatDate(t.updatedAt)}`}>
              {idle} d
            </span>
            <span className="task-assignee">{t.assigneeId ? <Avatar user={userById.get(t.assigneeId)} size={22} /> : <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} />}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function WorkloadWidget({ widget, data, days }: Props) {
  const { open, scoped } = useTasks(widget, data)
  const { users, userById, can } = useData()
  // Per-person numbers were always for people who can see the audit log.
  if (!can('view_audit')) return <p className="muted w-empty">Workload is visible to people who can see the audit log</p>
  const since = data.now - days * DAY
  const people = users
    .filter((u) => u.status !== 'disabled')
    .map((u) => {
      const mine = open.filter((t) => t.assigneeId === u.id)
      return { u, counts: byStatus(mine), load: mine.length, closed: scoped.filter((t) => t.assigneeId === u.id && t.closedAt !== null && t.closedAt >= since).length }
    })
    .filter((p) => p.load + p.closed > 0)
    .sort((a, b) => b.load - a.load || b.closed - a.closed)
  if (!people.length) return <p className="muted w-empty">Nobody has anything assigned</p>
  const maxLoad = Math.max(1, ...people.map((p) => p.load))
  return (
    <ul className="workload">
      {people.map((p) => (
        <li key={p.u.id}>
          <span className="user-chip">
            <Avatar user={userById.get(p.u.id)} size={24} />
            <span className="truncate">{displayName(p.u)}</span>
          </span>
          <span className="workload-bar">
            <StackBar counts={p.counts} scale={p.load / maxLoad} />
            <span className="small num">{p.load}</span>
          </span>
          <span className="muted small num workload-closed" title={`Finished in the last ${days} days`}>
            ✓ {p.closed}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Note ---------- */

export function NoteWidget({ widget }: Props) {
  const text = str(widget.config.text).trim()
  if (!text) return <p className="muted w-empty">Write something in the widget settings</p>
  return (
    <div className="w-note">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  )
}

export const RENDERERS: Record<Widget['type'], (p: Props) => ReactNode> = {
  number: NumberWidget,
  countdown: CountdownWidget,
  deadlines: DeadlinesWidget,
  breakdown: BreakdownWidget,
  progress: ProgressWidget,
  timeline: TimelineWidget,
  honeycomb: HoneycombWidget,
  activity: ActivityWidget,
  stuck: StuckWidget,
  workload: WorkloadWidget,
  note: NoteWidget,
}
