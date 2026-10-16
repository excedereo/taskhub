import { Router } from 'express'
import { db, transaction } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { badRequest, idParam, me, notFound, oneOf, requirePermission, text } from '../http.ts'

export const statusesRouter = Router()

/**
 * Every status has a type, and all logic (Take, Finished, Stuck, filters, analytics) looks at the type,
 * never at the name: todo = not started, active = being worked on, done = finished.
 */
export const STATUS_TYPES = ['todo', 'active', 'done'] as const
export type StatusType = (typeof STATUS_TYPES)[number]

type StatusRow = { id: number; name: string; color: string; icon: string | null; type: StatusType; position: number; task_count: number }

const serializeStatus = (s: StatusRow) => ({ id: s.id, name: s.name, color: s.color, icon: s.icon, type: s.type, position: s.position, taskCount: s.task_count })

const SELECT = `SELECT s.*, (SELECT COUNT(*) FROM tasks t WHERE t.status_id = s.id AND t.archived_at IS NULL) AS task_count FROM statuses s`
const getStatus = (id: number) => db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as StatusRow | undefined
const list = () => (db.prepare(`${SELECT} ORDER BY s.position, s.id`).all() as StatusRow[]).map(serializeStatus)

/** The first status of a type in the workspace order, e.g. where Take moves a task. */
export function firstOfType(type: StatusType): number {
  return (db.prepare('SELECT id FROM statuses WHERE type = ? ORDER BY position, id LIMIT 1').get(type) as { id: number }).id
}

export function statusTypeOf(id: number): StatusType {
  return (db.prepare('SELECT type FROM statuses WHERE id = ?').get(id) as { type: StatusType }).type
}

export function parseStatusId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !db.prepare('SELECT 1 FROM statuses WHERE id = ?').get(value)) throw badRequest('Unknown status')
  return value
}

export function parseColor(value: unknown) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw badRequest('Color must be a hex value like #3b82f6')
  return value.toLowerCase()
}

/** Icon keys come from the curated set in the web app; the server only checks the shape. */
export function parseIcon(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,40}$/.test(value)) throw badRequest('Unknown icon')
  return value
}

const countOfType = (type: StatusType) => (db.prepare('SELECT COUNT(*) AS n FROM statuses WHERE type = ?').get(type) as { n: number }).n

function assertNameFree(name: string, exceptId = 0) {
  if (db.prepare('SELECT 1 FROM statuses WHERE name = ? AND id != ?').get(name, exceptId)) throw badRequest('A status with this name already exists')
}

statusesRouter.get('/statuses', (_req, res) => {
  res.json(list())
})

statusesRouter.post('/statuses', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 24 })
  const type = oneOf(req.body?.type ?? 'active', 'Type', STATUS_TYPES)
  const color = parseColor(req.body?.color ?? '#a1a1aa')
  const icon = parseIcon(req.body?.icon ?? null)
  assertNameFree(name)
  transaction(() => {
    // A new status lands right after the last status of its type, so the list stays grouped by flow.
    const last = db.prepare('SELECT MAX(position) AS p FROM statuses WHERE type = ?').get(type) as { p: number | null }
    const position = last.p === null ? (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM statuses').get() as { p: number }).p : last.p + 0.5
    const id = Number(db.prepare('INSERT INTO statuses (name, color, icon, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(name, color, icon, type, position, Date.now()).lastInsertRowid)
    const ordered = db.prepare('SELECT id FROM statuses ORDER BY position, id').all() as { id: number }[]
    ordered.forEach((s, i) => db.prepare('UPDATE statuses SET position = ? WHERE id = ?').run(i + 1, s.id))
    audit(actor.id, 'status', id, 'status.created', { name, type })
  })
  res.status(201).json(list())
})

statusesRouter.patch('/statuses/:id', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const status = getStatus(idParam(req))
  if (!status) throw notFound('Status not found')
  const next: { name?: string; color?: string; icon?: string | null; type?: StatusType } = {}
  if (req.body?.name !== undefined) {
    next.name = text(req.body.name, 'Name', { min: 1, max: 24 })
    assertNameFree(next.name, status.id)
  }
  if (req.body?.color !== undefined) next.color = parseColor(req.body.color)
  if (req.body?.icon !== undefined) next.icon = parseIcon(req.body.icon)
  if (req.body?.type !== undefined) {
    next.type = oneOf(req.body.type, 'Type', STATUS_TYPES)
    if (next.type !== status.type && countOfType(status.type) === 1) throw badRequest(`This is the only "${status.type}" status, so its type cannot change`)
  }
  const changes = diff(status, next)
  if (Object.keys(changes).length) {
    transaction(() => {
      db.prepare('UPDATE statuses SET name = ?, color = ?, icon = ?, type = ? WHERE id = ?').run(
        next.name ?? status.name,
        next.color ?? status.color,
        next.icon === undefined ? status.icon : next.icon,
        next.type ?? status.type,
        status.id,
      )
      // Turning a status into "done" (or back) closes or reopens its tasks, like moving them would.
      if (changes.type) {
        if (next.type === 'done') db.prepare('UPDATE tasks SET closed_at = ? WHERE status_id = ? AND closed_at IS NULL').run(Date.now(), status.id)
        else db.prepare('UPDATE tasks SET closed_at = NULL WHERE status_id = ?').run(status.id)
      }
      audit(actor.id, 'status', status.id, 'status.updated', { name: next.name ?? status.name, changes })
    })
  }
  res.json(list())
})

statusesRouter.put('/statuses/order', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const ids: unknown = req.body?.ids
  const all = (db.prepare('SELECT id FROM statuses').all() as { id: number }[]).map((r) => r.id)
  if (!Array.isArray(ids) || ids.length !== all.length || !all.every((id) => ids.includes(id))) throw badRequest('ids must list every status once')
  transaction(() => {
    ;(ids as number[]).forEach((id, i) => db.prepare('UPDATE statuses SET position = ? WHERE id = ?').run(i + 1, id))
    audit(actor.id, 'status', null, 'status.reordered', {})
  })
  res.json(list())
})

/** Tasks move to another status of the same type; the last status of a type cannot go. */
statusesRouter.delete('/statuses/:id', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const status = getStatus(idParam(req))
  if (!status) throw notFound('Status not found')
  if (countOfType(status.type) === 1) throw badRequest(`This is the only "${status.type}" status. Add another one of that type first.`)
  transaction(() => {
    const target = (db.prepare('SELECT id FROM statuses WHERE type = ? AND id != ? ORDER BY position LIMIT 1').get(status.type, status.id) as { id: number }).id
    const moved = db.prepare('UPDATE tasks SET status_id = ? WHERE status_id = ?').run(target, status.id).changes
    db.prepare('DELETE FROM statuses WHERE id = ?').run(status.id)
    audit(actor.id, 'status', status.id, 'status.deleted', { name: status.name, movedTasks: Number(moved) })
  })
  res.json(list())
})
