import { Router } from 'express'
import { db, transaction } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { badRequest, can, forbidden, idParam, me, notFound, requirePermission, text } from '../http.ts'

export const categoriesRouter = Router()

type CategoryRow = {
  id: number
  name: string
  description: string
  archived: number
  created_by: number | null
  created_at: number
  open_count: number
  done_top_count: number
  total_count: number
}

const serializeCategory = (c: CategoryRow) => ({
  id: c.id,
  name: c.name,
  description: c.description,
  archived: Boolean(c.archived),
  createdBy: c.created_by,
  createdAt: c.created_at,
  openCount: c.open_count,
  doneCount: c.done_top_count,
  totalCount: c.total_count,
})

const CATEGORY_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id AND t.status != 'done' AND t.archived_at IS NULL) AS open_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id AND t.status = 'done' AND t.archived_at IS NULL AND t.parent_id IS NULL) AS done_top_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id) AS total_count
  FROM categories c`

const getCategory = (id: number) => db.prepare(`${CATEGORY_SELECT} WHERE c.id = ?`).get(id) as CategoryRow | undefined

categoriesRouter.get('/categories', (_req, res) => {
  const rows = db.prepare(`${CATEGORY_SELECT} ORDER BY c.archived, c.name COLLATE NOCASE`).all() as CategoryRow[]
  res.json(rows.map(serializeCategory))
})

categoriesRouter.post('/categories', requirePermission('manage_categories'), (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 48 })
  const description = text(req.body?.description ?? '', 'Description', { max: 500 })

  const id = transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO categories (name, description, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(name, description, actor.id, Date.now())
    const id = Number(lastInsertRowid)
    audit(actor.id, 'category', id, 'category.created', { name })
    return id
  })
  res.status(201).json(serializeCategory(getCategory(id)!))
})

categoriesRouter.patch('/categories/:id', requirePermission('manage_categories'), (req, res) => {
  const actor = me(req)
  const category = getCategory(idParam(req))
  if (!category) throw notFound('Category not found')

  const next: { name?: string; description?: string; archived?: number } = {}
  if (req.body?.name !== undefined) next.name = text(req.body.name, 'Name', { min: 1, max: 48 })
  if (req.body?.description !== undefined) next.description = text(req.body.description, 'Description', { max: 500 })
  if (req.body?.archived !== undefined) next.archived = req.body.archived ? 1 : 0

  const changes = diff(category, next)
  if (Object.keys(changes).length) {
    transaction(() => {
      db.prepare('UPDATE categories SET name = ?, description = ?, archived = ? WHERE id = ?')
        .run(next.name ?? category.name, next.description ?? category.description, next.archived ?? category.archived, category.id)
      audit(actor.id, 'category', category.id, 'category.updated', { name: next.name ?? category.name, changes })
    })
  }
  res.json(serializeCategory(getCategory(category.id)!))
})

type SectionRow = { id: number; category_id: number; title: string; position: number }

const serializeSection = (s: SectionRow) => ({ id: s.id, categoryId: s.category_id, title: s.title, position: s.position })

const listSections = (categoryId: number) =>
  (db.prepare('SELECT * FROM sections WHERE category_id = ? ORDER BY position').all(categoryId) as SectionRow[]).map(serializeSection)

categoriesRouter.get('/categories/:id/sections', (req, res) => {
  res.json(listSections(idParam(req)))
})

type LayoutItem = { type: 'section'; id?: number; title: string } | { type: 'task'; id: number; subtasks?: number[] }

/**
 * Saves the manual order of a category in one go: sections and top-level tasks share one sequence,
 * subtasks are ordered inside their parent. Sections missing from the list are deleted.
 * Tasks the client did not know about (created meanwhile) keep their order at the end.
 */
categoriesRouter.put('/categories/:id/layout', (req, res) => {
  const actor = me(req)
  if (!can(req, 'manage_categories') && !can(req, 'edit_tasks')) throw forbidden('You cannot rearrange categories')
  const category = getCategory(idParam(req))
  if (!category) throw notFound('Category not found')

  const items: unknown = req.body?.items
  if (!Array.isArray(items) || items.length > 5000) throw badRequest('items must be a list')

  const topTasks = (db.prepare('SELECT id FROM tasks WHERE category_id = ? AND parent_id IS NULL ORDER BY position').all(category.id) as { id: number }[]).map((r) => r.id)
  const topSet = new Set(topTasks)
  const sections = new Map((db.prepare('SELECT * FROM sections WHERE category_id = ?').all(category.id) as SectionRow[]).map((s) => [s.id, s]))

  const added: string[] = []
  const renamed: [string, string][] = []
  const kept = new Set<number>()
  const seen = new Set<number>()

  transaction(() => {
    const now = Date.now()
    let pos = 1
    for (const raw of items as LayoutItem[]) {
      if (raw?.type === 'section') {
        const title = text(raw.title, 'Section title', { min: 1, max: 80 })
        if (raw.id !== undefined) {
          const existing = sections.get(Number(raw.id))
          if (!existing) throw badRequest('Unknown section in layout')
          if (existing.title !== title) renamed.push([existing.title, title])
          db.prepare('UPDATE sections SET title = ?, position = ? WHERE id = ?').run(title, pos, existing.id)
          kept.add(existing.id)
        } else {
          db.prepare('INSERT INTO sections (category_id, title, position, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(category.id, title, pos, actor.id, now)
          added.push(title)
        }
      } else if (raw?.type === 'task') {
        const id = Number(raw.id)
        if (!topSet.has(id) || seen.has(id)) throw badRequest('Unknown or repeated task in layout')
        seen.add(id)
        db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(pos, id)

        if (Array.isArray(raw.subtasks)) {
          const children = (db.prepare('SELECT id FROM tasks WHERE parent_id = ? ORDER BY position').all(id) as { id: number }[]).map((r) => r.id)
          const childSet = new Set(children)
          const order = raw.subtasks.map(Number).filter((c) => childSet.has(c))
          const rest = children.filter((c) => !order.includes(c))
          ;[...new Set(order), ...rest].forEach((c, i) => db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(i + 1, c))
        }
      } else {
        throw badRequest('Each item must be a section or a task')
      }
      pos++
    }
    for (const id of topTasks) {
      if (!seen.has(id)) db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(pos++, id)
    }
    const removed = [...sections.values()].filter((s) => !kept.has(s.id))
    for (const s of removed) db.prepare('DELETE FROM sections WHERE id = ?').run(s.id)

    audit(actor.id, 'category', category.id, 'category.arranged', { name: category.name, added, removed: removed.map((s) => s.title), renamed })
  })

  res.json(listSections(category.id))
})

// Clears finished work out of a plan in one go; subtasks follow their parents.
categoriesRouter.post('/categories/:id/archive-done', (req, res) => {
  const actor = me(req)
  if (!can(req, 'manage_categories') && !can(req, 'edit_tasks')) throw forbidden()
  const category = getCategory(idParam(req))
  if (!category) throw notFound('Category not found')

  const archived = transaction(() => {
    const now = Date.now()
    const ids = (db.prepare(`SELECT id FROM tasks WHERE category_id = ? AND status = 'done' AND archived_at IS NULL AND parent_id IS NULL`).all(category.id) as { id: number }[]).map((r) => r.id)
    for (const id of ids) db.prepare('UPDATE tasks SET archived_at = ? WHERE id = ? OR (parent_id = ? AND archived_at IS NULL)').run(now, id, id)
    if (ids.length) audit(actor.id, 'category', category.id, 'category.archived_done', { name: category.name, count: ids.length })
    return ids.length
  })
  res.json({ archived })
})

categoriesRouter.delete('/categories/:id', requirePermission('manage_categories'), (req, res) => {
  const actor = me(req)
  const category = getCategory(idParam(req))
  if (!category) throw notFound('Category not found')
  if (category.total_count > 0) throw badRequest('Only empty categories can be deleted. Archive it instead.')

  transaction(() => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.id)
    audit(actor.id, 'category', category.id, 'category.deleted', { name: category.name })
  })
  res.json({ ok: true })
})
