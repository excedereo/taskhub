import { Router } from 'express'
import { db, transaction } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { badRequest, idParam, me, notFound, requirePermission, text } from '../http.ts'

export const labelsRouter = Router()

type LabelRow = { id: number; name: string; color: string; created_at: number; task_count: number }

const serializeLabel = (l: LabelRow) => ({ id: l.id, name: l.name, color: l.color, taskCount: l.task_count })

const LABEL_SELECT = `
  SELECT l.*, (SELECT COUNT(*) FROM task_labels tl JOIN tasks t ON t.id = tl.task_id WHERE tl.label_id = l.id AND t.archived_at IS NULL) AS task_count
  FROM labels l`

const getLabel = (id: number) => db.prepare(`${LABEL_SELECT} WHERE l.id = ?`).get(id) as LabelRow | undefined

function parseColor(value: unknown) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw badRequest('Color must be a hex value like #3b82f6')
  return value.toLowerCase()
}

function assertNameFree(name: string, exceptId = 0) {
  if (db.prepare('SELECT 1 FROM labels WHERE name = ? AND id != ?').get(name, exceptId)) throw badRequest('A label with this name already exists')
}

/** Validates a list of label ids coming from a task form. */
export function parseLabelIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 20 || !value.every((v) => Number.isSafeInteger(v) && v > 0)) throw badRequest('labelIds must be a list of label ids')
  const ids = [...new Set(value as number[])].sort((a, b) => a - b)
  if (ids.length) {
    const known = (db.prepare(`SELECT COUNT(*) AS n FROM labels WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { n: number }).n
    if (known !== ids.length) throw badRequest('Unknown label')
  }
  return ids
}

labelsRouter.get('/labels', (_req, res) => {
  const rows = db.prepare(`${LABEL_SELECT} ORDER BY l.name COLLATE NOCASE`).all() as LabelRow[]
  res.json(rows.map(serializeLabel))
})

labelsRouter.post('/labels', requirePermission('manage_categories'), (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 32 })
  const color = parseColor(req.body?.color ?? '#a1a1aa')
  assertNameFree(name)
  const id = transaction(() => {
    const id = Number(db.prepare('INSERT INTO labels (name, color, created_at) VALUES (?, ?, ?)').run(name, color, Date.now()).lastInsertRowid)
    audit(actor.id, 'label', id, 'label.created', { name })
    return id
  })
  res.status(201).json(serializeLabel(getLabel(id)!))
})

labelsRouter.patch('/labels/:id', requirePermission('manage_categories'), (req, res) => {
  const actor = me(req)
  const label = getLabel(idParam(req))
  if (!label) throw notFound('Label not found')
  const next: { name?: string; color?: string } = {}
  if (req.body?.name !== undefined) {
    next.name = text(req.body.name, 'Name', { min: 1, max: 32 })
    assertNameFree(next.name, label.id)
  }
  if (req.body?.color !== undefined) next.color = parseColor(req.body.color)
  const changes = diff(label, next)
  if (Object.keys(changes).length) {
    transaction(() => {
      db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(next.name ?? label.name, next.color ?? label.color, label.id)
      audit(actor.id, 'label', label.id, 'label.updated', { name: next.name ?? label.name, changes })
    })
  }
  res.json(serializeLabel(getLabel(label.id)!))
})

labelsRouter.delete('/labels/:id', requirePermission('manage_categories'), (req, res) => {
  const actor = me(req)
  const label = getLabel(idParam(req))
  if (!label) throw notFound('Label not found')
  transaction(() => {
    db.prepare('DELETE FROM labels WHERE id = ?').run(label.id)
    audit(actor.id, 'label', label.id, 'label.deleted', { name: label.name, tasks: label.task_count })
  })
  res.json({ ok: true })
})
