import { Router } from 'express'
import { db, transaction } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { badRequest, idParam, me, notFound, requirePermission, text } from '../http.ts'

export const prioritiesRouter = Router()

type PriorityRow = { id: number; name: string; color: string; position: number; is_default: number; task_count: number }

const serializePriority = (p: PriorityRow) => ({ id: p.id, name: p.name, color: p.color, position: p.position, isDefault: Boolean(p.is_default), taskCount: p.task_count })

const SELECT = `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.priority_id = p.id AND t.archived_at IS NULL) AS task_count FROM priorities p`
const getPriority = (id: number) => db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as PriorityRow | undefined
const list = () => (db.prepare(`${SELECT} ORDER BY p.position, p.id`).all() as PriorityRow[]).map(serializePriority)

export const defaultPriorityId = () => (db.prepare('SELECT id FROM priorities ORDER BY is_default DESC, position LIMIT 1').get() as { id: number }).id

/** Accepts a priority id for a task, falling back to the default one when nothing is given. */
export function parsePriorityId(value: unknown): number {
  if (value === undefined || value === null) return defaultPriorityId()
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !db.prepare('SELECT 1 FROM priorities WHERE id = ?').get(value)) throw badRequest('Unknown priority')
  return value
}

function parseColor(value: unknown) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw badRequest('Color must be a hex value like #3b82f6')
  return value.toLowerCase()
}

function assertNameFree(name: string, exceptId = 0) {
  if (db.prepare('SELECT 1 FROM priorities WHERE name = ? AND id != ?').get(name, exceptId)) throw badRequest('A priority with this name already exists')
}

prioritiesRouter.get('/priorities', (_req, res) => {
  res.json(list())
})

prioritiesRouter.post('/priorities', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 24 })
  const color = parseColor(req.body?.color ?? '#a1a1aa')
  assertNameFree(name)
  transaction(() => {
    // New priorities go to the bottom: least important.
    const position = (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM priorities').get() as { p: number }).p
    const id = Number(db.prepare('INSERT INTO priorities (name, color, position, created_at) VALUES (?, ?, ?, ?)').run(name, color, position, Date.now()).lastInsertRowid)
    audit(actor.id, 'priority', id, 'priority.created', { name })
  })
  res.status(201).json(list())
})

prioritiesRouter.patch('/priorities/:id', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const priority = getPriority(idParam(req))
  if (!priority) throw notFound('Priority not found')
  const next: { name?: string; color?: string } = {}
  if (req.body?.name !== undefined) {
    next.name = text(req.body.name, 'Name', { min: 1, max: 24 })
    assertNameFree(next.name, priority.id)
  }
  if (req.body?.color !== undefined) next.color = parseColor(req.body.color)
  const makeDefault = req.body?.isDefault === true && !priority.is_default
  const changes: Record<string, unknown> = diff(priority, next)
  if (makeDefault) changes.isDefault = [false, true]
  if (Object.keys(changes).length) {
    transaction(() => {
      db.prepare('UPDATE priorities SET name = ?, color = ? WHERE id = ?').run(next.name ?? priority.name, next.color ?? priority.color, priority.id)
      if (makeDefault) {
        db.prepare('UPDATE priorities SET is_default = 0').run()
        db.prepare('UPDATE priorities SET is_default = 1 WHERE id = ?').run(priority.id)
      }
      audit(actor.id, 'priority', priority.id, 'priority.updated', { name: next.name ?? priority.name, changes })
    })
  }
  res.json(list())
})

/** Most important first. */
prioritiesRouter.put('/priorities/order', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const ids: unknown = req.body?.ids
  const all = (db.prepare('SELECT id FROM priorities').all() as { id: number }[]).map((r) => r.id)
  if (!Array.isArray(ids) || ids.length !== all.length || !all.every((id) => ids.includes(id))) throw badRequest('ids must list every priority once')
  transaction(() => {
    ;(ids as number[]).forEach((id, i) => db.prepare('UPDATE priorities SET position = ? WHERE id = ?').run(i + 1, id))
    audit(actor.id, 'priority', null, 'priority.reordered', {})
  })
  res.json(list())
})

/** Tasks that used the deleted priority move to the default one, so nothing is left without a priority. */
prioritiesRouter.delete('/priorities/:id', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const priority = getPriority(idParam(req))
  if (!priority) throw notFound('Priority not found')
  if (priority.is_default) throw badRequest('This is the default priority. Make another one the default first.')
  transaction(() => {
    const moved = db.prepare('UPDATE tasks SET priority_id = ? WHERE priority_id = ?').run(defaultPriorityId(), priority.id).changes
    db.prepare('DELETE FROM priorities WHERE id = ?').run(priority.id)
    audit(actor.id, 'priority', priority.id, 'priority.deleted', { name: priority.name, movedTasks: Number(moved) })
  })
  res.json(list())
})
