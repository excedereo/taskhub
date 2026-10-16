import { Router } from 'express'
import { db } from '../db.ts'
import { can } from '../http.ts'

export const analyticsRouter = Router()

const DAY = 24 * 60 * 60 * 1000
const STALE_IN_PROGRESS_DAYS = 7
const STALE_REVIEW_DAYS = 3
// Very short "cycles" are tasks that were closed the moment they were created (imports, quick fixes logged after the fact).
const MIN_CYCLE_MS = 60 * 1000

type Row = {
  id: number
  category_id: number
  parent_id: number | null
  position: number
  title: string
  status: 'open' | 'in_progress' | 'review' | 'done'
  assignee_id: number | null
  created_at: number
  updated_at: number
  closed_at: number | null
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * Everything the analytics page shows, computed in one pass over non-archived tasks.
 * `tz` is the browser's getTimezoneOffset(), so daily and weekly buckets match the viewer's calendar.
 */
analyticsRouter.get('/analytics', (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30
  const tz = Math.max(-840, Math.min(840, Number(req.query.tz) || 0))
  const offset = -tz * 60 * 1000
  const now = Date.now()
  const since = now - days * DAY
  const prevSince = since - days * DAY

  const tasks = db.prepare(`
    SELECT id, category_id, parent_id, position, title, status, assignee_id, created_at, updated_at, closed_at
    FROM tasks WHERE archived_at IS NULL
  `).all() as Row[]

  // ---- Overview
  const inRange = (ts: number | null, from: number, to: number) => ts !== null && ts >= from && ts < to
  const overview = {
    open: tasks.filter((t) => t.status === 'open').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    review: tasks.filter((t) => t.status === 'review').length,
    done: tasks.filter((t) => t.status === 'done').length,
    closed: tasks.filter((t) => t.status === 'done' && inRange(t.closed_at, since, now + 1)).length,
    closedPrev: tasks.filter((t) => t.status === 'done' && inRange(t.closed_at, prevSince, since)).length,
    created: tasks.filter((t) => inRange(t.created_at, since, now + 1)).length,
    createdPrev: tasks.filter((t) => inRange(t.created_at, prevSince, since)).length,
  }

  // ---- Progress per category and section (top-level tasks, like the category page)
  const categoryRows = db.prepare('SELECT id, name FROM categories WHERE archived = 0 ORDER BY name COLLATE NOCASE').all() as { id: number; name: string }[]
  const sectionRows = db.prepare('SELECT id, category_id, title, position FROM sections ORDER BY position').all() as { id: number; category_id: number; title: string; position: number }[]

  const categories = categoryRows.map((c) => {
    const top = tasks.filter((t) => t.category_id === c.id && !t.parent_id)
    const done = top.filter((t) => t.status === 'done')
    const sections: { id: number | null; title: string | null; total: number; done: number }[] = [{ id: null, title: null, total: 0, done: 0 }]
    const items = [
      ...sectionRows.filter((s) => s.category_id === c.id).map((s) => ({ pos: s.position, section: s })),
      ...top.map((t) => ({ pos: t.position, task: t })),
    ].sort((a, b) => a.pos - b.pos)
    for (const item of items) {
      if ('section' in item) sections.push({ id: item.section.id, title: item.section.title, total: 0, done: 0 })
      else {
        const s = sections[sections.length - 1]
        s.total++
        if (item.task.status === 'done') s.done++
      }
    }

    // Pace over the last four weeks, whatever the selected period, so the forecast is not too jumpy.
    const recent = done.filter((t) => (t.closed_at ?? 0) >= now - 28 * DAY).length
    const remaining = top.length - done.length
    const perWeek = recent / 4
    return {
      id: c.id,
      name: c.name,
      total: top.length,
      done: done.length,
      inProgress: top.filter((t) => t.status === 'in_progress').length,
      review: top.filter((t) => t.status === 'review').length,
      open: top.filter((t) => t.status === 'open').length,
      sections: sections.filter((s) => s.id !== null || s.total > 0),
      forecast: { remaining, perWeek, weeks: remaining && perWeek ? remaining / perWeek : null },
    }
  })

  // ---- Throughput: daily buckets up to a month, weekly (Monday) beyond that
  const localDay = (ts: number) => Math.floor((ts + offset) / DAY)
  let unit: 'day' | 'week'
  let starts: number[]
  if (days <= 31) {
    unit = 'day'
    const first = (localDay(now) - (days - 1)) * DAY - offset
    starts = Array.from({ length: days }, (_, i) => first + i * DAY)
  } else {
    unit = 'week'
    const today = localDay(now)
    const monday = (today - ((today + 3) % 7)) * DAY - offset // 1970-01-01 was a Thursday
    const weeks = Math.ceil(days / 7)
    starts = Array.from({ length: weeks }, (_, i) => monday - (weeks - 1 - i) * 7 * DAY)
  }
  const size = unit === 'day' ? DAY : 7 * DAY
  const buckets = starts.map((start) => ({
    start,
    created: tasks.filter((t) => inRange(t.created_at, start, start + size)).length,
    closed: tasks.filter((t) => t.status === 'done' && inRange(t.closed_at, start, start + size)).length,
  }))

  // ---- Stale work
  const stale = tasks
    .filter(
      (t) =>
        (t.status === 'in_progress' && t.updated_at < now - STALE_IN_PROGRESS_DAYS * DAY) ||
        (t.status === 'review' && t.updated_at < now - STALE_REVIEW_DAYS * DAY),
    )
    .map((t) => ({ id: t.id, title: t.title, status: t.status, assigneeId: t.assignee_id, categoryId: t.category_id, idleDays: Math.floor((now - t.updated_at) / DAY) }))
    .sort((a, b) => b.idleDays - a.idleDays)
    .slice(0, 25)

  const result: Record<string, unknown> = {
    days,
    staleThresholds: { inProgress: STALE_IN_PROGRESS_DAYS, review: STALE_REVIEW_DAYS },
    overview,
    categories,
    throughput: { unit, buckets },
    stale,
  }

  // ---- Per-person numbers: only for people who can see the audit log
  if (can(req, 'view_audit')) {
    const users = db.prepare(`SELECT id FROM users WHERE status != 'disabled'`).all() as { id: number }[]
    result.people = users
      .map((u) => {
        const mine = tasks.filter((t) => t.assignee_id === u.id)
        return {
          userId: u.id,
          inProgress: mine.filter((t) => t.status === 'in_progress').length,
          review: mine.filter((t) => t.status === 'review').length,
          open: mine.filter((t) => t.status === 'open').length,
          closed: mine.filter((t) => t.status === 'done' && inRange(t.closed_at, since, now + 1)).length,
        }
      })
      .filter((p) => p.inProgress + p.review + p.open + p.closed > 0)
      .sort((a, b) => b.inProgress + b.review - (a.inProgress + a.review) || b.closed - a.closed)

    // Cycle time: from the first move to "In progress" (or creation, if it never got there) until done.
    const closed = tasks.filter((t) => t.status === 'done' && inRange(t.closed_at, since, now + 1))
    const started = new Map<number, number>()
    if (closed.length) {
      const events = db.prepare(`
        SELECT entity_id, data, created_at FROM audit_log
        WHERE entity_type = 'task' AND action IN ('task.taken', 'task.updated', 'task.assigned')
          AND entity_id IN (${closed.map(() => '?').join(',')})
        ORDER BY id
      `).all(...closed.map((t) => t.id)) as { entity_id: number; data: string; created_at: number }[]
      for (const e of events) {
        if (started.has(e.entity_id)) continue
        const status = (JSON.parse(e.data) as { changes?: { status?: [string, string] } }).changes?.status
        if (status?.[1] === 'in_progress') started.set(e.entity_id, e.created_at)
      }
    }
    const cycles = closed
      .map((t) => ({ categoryId: t.category_id, ms: (t.closed_at ?? 0) - (started.get(t.id) ?? t.created_at) }))
      .filter((c) => c.ms >= MIN_CYCLE_MS)
    result.cycle = {
      count: cycles.length,
      skipped: closed.length - cycles.length,
      medianMs: median(cycles.map((c) => c.ms)),
      averageMs: average(cycles.map((c) => c.ms)),
      byCategory: categoryRows
        .map((c) => {
          const xs = cycles.filter((x) => x.categoryId === c.id).map((x) => x.ms)
          return { categoryId: c.id, count: xs.length, medianMs: median(xs) }
        })
        .filter((c) => c.count > 0),
    }
  }

  res.json(result)
})
