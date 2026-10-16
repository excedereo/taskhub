import { Router, type Request } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { db, transaction } from '../db.ts'
import { audit, diff, serializeAudit, type AuditRow } from '../audit.ts'
import { badRequest, can, forbidden, idParam, me, notFound, oneOf, optionalId, requirePermission, text } from '../http.ts'
import { listAttachments, removeFiles } from './attachments.ts'

export const tasksRouter = Router()

export const STATUSES = ['open', 'in_progress', 'review', 'done'] as const
export const PRIORITIES = ['low', 'medium', 'high'] as const

type TaskRow = {
  id: number
  category_id: number
  title: string
  description: string
  status: (typeof STATUSES)[number]
  priority: (typeof PRIORITIES)[number]
  creator_id: number | null
  assignee_id: number | null
  created_at: number
  updated_at: number
  closed_at: number | null
  attachment_count?: number
}

const serializeTask = (t: TaskRow) => ({
  attachmentCount: t.attachment_count ?? (db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE task_id = ?').get(t.id) as { n: number }).n,
  id: t.id,
  categoryId: t.category_id,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  creatorId: t.creator_id,
  assigneeId: t.assignee_id,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  closedAt: t.closed_at,
})

export const getTask = (id: number) => db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined

export function requireTask(req: Request) {
  const task = getTask(idParam(req))
  if (!task) throw notFound('Task not found')
  return task
}

function assertActiveCategory(id: number) {
  const row = db.prepare('SELECT archived FROM categories WHERE id = ?').get(id) as { archived: number } | undefined
  if (!row) throw badRequest('Category does not exist')
  if (row.archived) throw badRequest('Category is archived')
}

function assertAssignable(userId: number) {
  const row = db.prepare('SELECT status FROM users WHERE id = ?').get(userId) as { status: string } | undefined
  if (!row) throw badRequest('User does not exist')
  if (row.status === 'disabled') throw badRequest('This user is disabled')
}

export const canEdit = (req: Request, task: TaskRow) => can(req, 'edit_tasks') || task.creator_id === me(req).id
/** People working on a task: they may move it and attach files. */
export const canWork = (req: Request, task: TaskRow) => canEdit(req, task) || task.assignee_id === me(req).id

/** Writes changed columns, keeps closed_at in sync with status and records one audit entry. */
function applyChanges(actorId: number, task: TaskRow, next: Partial<TaskRow>, action = 'task.updated', extra: Record<string, unknown> = {}) {
  const changes = diff(task, next)
  if (!Object.keys(changes).length) return task

  const merged = { ...task, ...next }
  const now = Date.now()
  if (changes.status) merged.closed_at = merged.status === 'done' ? now : null

  transaction(() => {
    db.prepare(`
      UPDATE tasks SET category_id = ?, title = ?, description = ?, status = ?, priority = ?, assignee_id = ?, updated_at = ?, closed_at = ?
      WHERE id = ?
    `).run(merged.category_id, merged.title, merged.description, merged.status, merged.priority, merged.assignee_id, now, merged.closed_at, task.id)
    audit(actorId, 'task', task.id, action, { title: merged.title, changes, ...extra })
  })
  return getTask(task.id)!
}

tasksRouter.get('/tasks', (req, res) => {
  const where: string[] = []
  const params: SQLInputValue[] = []
  const { categoryId, assignee, status, q } = req.query

  if (typeof categoryId === 'string' && categoryId) {
    where.push('category_id = ?')
    params.push(Number(categoryId))
  }
  if (assignee === 'me') {
    where.push('assignee_id = ?')
    params.push(me(req).id)
  } else if (assignee === 'none') {
    where.push('assignee_id IS NULL')
  } else if (typeof assignee === 'string' && /^\d+$/.test(assignee)) {
    where.push('assignee_id = ?')
    params.push(Number(assignee))
  }
  if (typeof status === 'string' && (STATUSES as readonly string[]).includes(status)) {
    where.push('status = ?')
    params.push(status)
  }
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim()
    if (/^#?\d+$/.test(term)) {
      where.push('(id = ? OR title LIKE ?)')
      params.push(Number(term.replace('#', '')), `%${term}%`)
    } else {
      where.push('(title LIKE ? OR description LIKE ?)')
      params.push(`%${term}%`, `%${term}%`)
    }
  }

  const rows = db.prepare(`
    SELECT tasks.*, (SELECT COUNT(*) FROM attachments a WHERE a.task_id = tasks.id) AS attachment_count
    FROM tasks
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1 WHEN 'open' THEN 2 ELSE 3 END,
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      updated_at DESC
    LIMIT 1000
  `).all(...params) as TaskRow[]
  res.json(rows.map(serializeTask))
})

tasksRouter.get('/tasks/:id', (req, res) => {
  const task = requireTask(req)
  const history = db.prepare(`SELECT * FROM audit_log WHERE entity_type = 'task' AND entity_id = ? ORDER BY id DESC`).all(task.id) as AuditRow[]
  res.json({ task: serializeTask(task), history: history.map(serializeAudit), attachments: listAttachments(task.id) })
})

tasksRouter.post('/tasks', requirePermission('create_tasks'), (req, res) => {
  const actor = me(req)
  const categoryId = optionalId(req.body?.categoryId, 'Category')
  if (!categoryId) throw badRequest('Category is required')
  assertActiveCategory(categoryId)

  const title = text(req.body?.title, 'Title', { min: 1, max: 200 })
  const description = text(req.body?.description ?? '', 'Description', { max: 20000 })
  const priority = oneOf(req.body?.priority ?? 'medium', 'Priority', PRIORITIES)
  const assigneeId = req.body?.assigneeId === undefined ? null : optionalId(req.body.assigneeId, 'Assignee')
  if (assigneeId !== null) {
    const selfTake = assigneeId === actor.id && can(req, 'take_tasks')
    if (!selfTake && !can(req, 'assign_tasks')) throw forbidden('You cannot assign tasks')
    assertAssignable(assigneeId)
  }

  const id = transaction(() => {
    const now = Date.now()
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO tasks (category_id, title, description, priority, creator_id, assignee_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(categoryId, title, description, priority, actor.id, assigneeId, now, now)
    const id = Number(lastInsertRowid)
    audit(actor.id, 'task', id, 'task.created', { title, categoryId, priority, assigneeId })
    return id
  })
  res.status(201).json(serializeTask(getTask(id)!))
})

tasksRouter.patch('/tasks/:id', (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  const body = req.body ?? {}
  const next: Partial<TaskRow> = {}

  const editsContent = ['title', 'description', 'priority', 'categoryId'].some((k) => body[k] !== undefined)
  if (editsContent && !canEdit(req, task)) throw forbidden('Only the author or someone with "Edit any task" can edit this task')
  if (body.status !== undefined && !canWork(req, task)) throw forbidden('Only the assignee, the author or an editor can change the status')

  if (body.title !== undefined) next.title = text(body.title, 'Title', { min: 1, max: 200 })
  if (body.description !== undefined) next.description = text(body.description, 'Description', { max: 20000 })
  if (body.priority !== undefined) next.priority = oneOf(body.priority, 'Priority', PRIORITIES)
  if (body.status !== undefined) next.status = oneOf(body.status, 'Status', STATUSES)
  if (body.categoryId !== undefined) {
    const categoryId = optionalId(body.categoryId, 'Category')
    if (!categoryId) throw badRequest('Category is required')
    if (categoryId !== task.category_id) assertActiveCategory(categoryId)
    next.category_id = categoryId
  }

  res.json(serializeTask(applyChanges(actor.id, task, next)))
})

tasksRouter.post('/tasks/:id/take', (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  if (!can(req, 'take_tasks') && !can(req, 'assign_tasks')) throw forbidden('You cannot take tasks')
  if (task.assignee_id === actor.id) return res.json(serializeTask(task))
  if (task.assignee_id !== null && !can(req, 'assign_tasks')) throw badRequest('Someone is already working on this task')
  if (task.status === 'done') throw badRequest('This task is already done')

  const next: Partial<TaskRow> = { assignee_id: actor.id }
  if (task.status === 'open') next.status = 'in_progress'
  res.json(serializeTask(applyChanges(actor.id, task, next, 'task.taken')))
})

tasksRouter.post('/tasks/:id/assign', (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  const userId = optionalId(req.body?.userId ?? null, 'User')

  // Anyone may drop a task they hold; everything else needs "Assign tasks".
  const droppingOwn = userId === null && task.assignee_id === actor.id
  if (!droppingOwn && !can(req, 'assign_tasks')) throw forbidden('You cannot assign tasks')
  if (userId !== null) assertAssignable(userId)

  const next: Partial<TaskRow> = { assignee_id: userId }
  if (userId === null && task.status === 'in_progress') next.status = 'open'
  res.json(serializeTask(applyChanges(actor.id, task, next, userId === null ? 'task.unassigned' : 'task.assigned')))
})

tasksRouter.delete('/tasks/:id', requirePermission('delete_tasks'), (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  const files = (db.prepare('SELECT file FROM attachments WHERE task_id = ?').all(task.id) as { file: string }[]).map((r) => r.file)
  transaction(() => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id)
    audit(actor.id, 'task', task.id, 'task.deleted', { title: task.title, categoryId: task.category_id })
  })
  removeFiles(files)
  res.json({ ok: true })
})
