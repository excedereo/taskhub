import { Router } from 'express'
import { db } from '../db.ts'
import { can, canSeeCategory, visibilityFilter } from '../http.ts'
import type { StatusType } from './statuses.ts'

export const analyticsRouter = Router()

const DAY = 24 * 60 * 60 * 1000
const STALE_DAYS = 7

type Row = {
  id: number
  category_id: number
  parent_id: number | null
  position: number
  title: string
  status_id: number
  type: StatusType
  assignee_id: number | null
  updated_at: number
  closed_at: number | null
}

/** Counts per status id, e.g. { 1: 4, 2: 1 }. */
function byStatus(rows: Row[]) {
  const out: Record<number, number> = {}
  for (const r of rows) out[r.status_id] = (out[r.status_id] ?? 0) + 1
  return out
}

/**
 * Everything the analytics page shows, computed in one pass over non-archived tasks.
 * Breakdowns are per status; "finished" and "stuck" are decided by the status type.
 */
analyticsRouter.get('/analytics', (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30
  const now = Date.now()
  const since = now - days * DAY

  const visible = visibilityFilter(req, 't.category_id')
  const tasks = db.prepare(`
    SELECT t.id, t.category_id, t.parent_id, t.position, t.title, t.status_id, s.type, t.assignee_id, t.updated_at, t.closed_at
    FROM tasks t JOIN statuses s ON s.id = t.status_id
    WHERE t.archived_at IS NULL${visible.sql}
  `).all(...visible.params) as Row[]

  const closedBetween = (from: number, to: number) => tasks.filter((t) => t.type === 'done' && t.closed_at !== null && t.closed_at >= from && t.closed_at < to).length
  const overview = {
    byStatus: byStatus(tasks.filter((t) => t.type !== 'done')),
    closed: closedBetween(since, now + 1),
    closedPrev: closedBetween(since - days * DAY, since),
  }

  const categoryRows = (db.prepare('SELECT id, name FROM categories WHERE archived = 0 ORDER BY position, id').all() as { id: number; name: string }[]).filter((c) => canSeeCategory(req, c.id))
  const sectionRows = db.prepare('SELECT id, category_id, title, position FROM sections ORDER BY position').all() as { id: number; category_id: number; title: string; position: number }[]

  const categories = categoryRows.map((c) => {
    const all = tasks.filter((t) => t.category_id === c.id)
    // Progress follows the category page: top-level tasks only, grouped by section.
    const top = all.filter((t) => !t.parent_id)
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
        if (item.task.type === 'done') s.done++
      }
    }
    return {
      id: c.id,
      name: c.name,
      total: top.length,
      done: top.filter((t) => t.type === 'done').length,
      byStatus: byStatus(top),
      sections: sections.filter((s) => s.id !== null || s.total > 0),
      // Unfinished work including subtasks, for the share-of-work chart.
      unfinished: byStatus(all.filter((t) => t.type !== 'done')),
    }
  })

  const stale = tasks
    .filter((t) => t.type === 'active' && t.updated_at < now - STALE_DAYS * DAY)
    .map((t) => ({ id: t.id, title: t.title, statusId: t.status_id, assigneeId: t.assignee_id, categoryId: t.category_id, idleDays: Math.floor((now - t.updated_at) / DAY) }))
    .sort((a, b) => b.idleDays - a.idleDays)
    .slice(0, 25)

  const result: Record<string, unknown> = { days, staleDays: STALE_DAYS, overview, categories, stale }

  // Per-person numbers only for people who can see the audit log.
  if (can(req, 'view_audit')) {
    const users = db.prepare(`SELECT id FROM users WHERE status != 'disabled'`).all() as { id: number }[]
    result.people = users
      .map((u) => {
        const mine = tasks.filter((t) => t.assignee_id === u.id)
        const open = mine.filter((t) => t.type !== 'done')
        return {
          userId: u.id,
          byStatus: byStatus(open),
          load: open.length,
          active: open.filter((t) => t.type === 'active').length,
          closed: mine.filter((t) => t.type === 'done' && (t.closed_at ?? 0) >= since).length,
        }
      })
      .filter((p) => p.load + p.closed > 0)
      .sort((a, b) => b.active - a.active || b.load - a.load || b.closed - a.closed)
  }

  res.json(result)
})
