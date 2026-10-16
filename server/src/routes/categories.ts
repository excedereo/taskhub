import { Router } from 'express'
import { db, transaction } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { badRequest, idParam, me, notFound, requirePermission, text } from '../http.ts'

export const categoriesRouter = Router()

type CategoryRow = {
  id: number
  name: string
  description: string
  archived: number
  created_by: number | null
  created_at: number
  open_count: number
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
  totalCount: c.total_count,
})

const CATEGORY_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id AND t.status != 'done') AS open_count,
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
