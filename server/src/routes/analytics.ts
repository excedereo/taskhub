import { Router } from 'express'
import { db } from '../db.ts'
import { can, canSeeCategory, visibilityFilter } from '../http.ts'

export const analyticsRouter = Router()

const DAY = 24 * 60 * 60 * 1000
const STALE_IN_PROGRESS_DAYS = 7
const STALE_REVIEW_DAYS = 3

type Row = {
  id: number
  category_id: number
  parent_id: number | null
  position: number
  title: string
  status: 'open' | 'in_progress' | 'review' | 'done'
  assignee_id: number | null
  updated_at: number
  closed_at: number | null
}

/** Everything the analytics page shows, computed in one pass over non-archived tasks. */
analyticsRouter.get('/analytics', (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30
  const now = Date.now()
  const since = now - days * DAY

  const visible = visibilityFilter(req, 'category_id')
  const tasks = db.prepare(`
    SELECT id, category_id, parent_id, position, title, status, assignee_id, updated_at, closed_at
    FROM tasks WHERE archived_at IS NULL${visible.sql}
  `).all(...visible.params) as Row[]

  const closedBetween = (from: number, to: number) => tasks.filter((t) => t.status === 'done' && t.closed_at !== null && t.closed_at >= from && t.closed_at < to).length
  const overview = {
    open: tasks.filter((t) => t.status === 'open').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    review: tasks.filter((t) => t.status === 'review').length,
    closed: closedBetween(since, now + 1),
    closedPrev: closedBetween(since - days * DAY, since),
  }

  const categoryRows = (db.prepare('SELECT id, name FROM categories WHERE archived = 0 ORDER BY id').all() as { id: number; name: string }[]).filter((c) => canSeeCategory(req, c.id))
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
        if (item.task.status === 'done') s.done++
      }
    }
    const count = (list: Row[], status: Row['status']) => list.filter((t) => t.status === status).length
    return {
      id: c.id,
      name: c.name,
      total: top.length,
      done: count(top, 'done'),
      inProgress: count(top, 'in_progress'),
      review: count(top, 'review'),
      open: count(top, 'open'),
      sections: sections.filter((s) => s.id !== null || s.total > 0),
      // Unfinished work including subtasks, for the share-of-work chart.
      unfinished: { open: count(all, 'open'), inProgress: count(all, 'in_progress'), review: count(all, 'review') },
    }
  })

  const stale = tasks
    .filter(
      (t) =>
        (t.status === 'in_progress' && t.updated_at < now - STALE_IN_PROGRESS_DAYS * DAY) ||
        (t.status === 'review' && t.updated_at < now - STALE_REVIEW_DAYS * DAY),
    )
    .map((t) => ({ id: t.id, title: t.title, status: t.status, assigneeId: t.assignee_id, categoryId: t.category_id, idleDays: Math.floor((now - t.updated_at) / DAY) }))
    .sort((a, b) => b.idleDays - a.idleDays)
    .slice(0, 25)

  const result: Record<string, unknown> = { days, overview, categories, stale }

  // Per-person numbers only for people who can see the audit log.
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
          closed: mine.filter((t) => t.status === 'done' && (t.closed_at ?? 0) >= since).length,
        }
      })
      .filter((p) => p.inProgress + p.review + p.open + p.closed > 0)
      .sort((a, b) => b.inProgress + b.review - (a.inProgress + a.review) || b.closed - a.closed)
  }

  res.json(result)
})
