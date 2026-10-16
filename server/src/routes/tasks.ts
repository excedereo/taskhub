import { Router, type Request } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { db, transaction } from '../db.ts'
import { audit, diff, serializeAudit, type AuditRow } from '../audit.ts'
import { badRequest, can, forbidden, idParam, me, notFound, oneOf, optionalId, requirePermission, text } from '../http.ts'
import { listAttachments, removeFiles } from './attachments.ts'

export const tasksRouter = Router()

export const STATUSES = ['open', 'in_progress', 'review', 'done'] as const
export const PRIORITIES = ['low', 'medium', 'high'] as const

export type TaskRow = {
  id: number
  category_id: number
  parent_id: number | null
  position: number
  title: string
  description: string
  status: (typeof STATUSES)[number]
  priority: (typeof PRIORITIES)[number]
  creator_id: number | null
  assignee_id: number | null
  created_at: number
  updated_at: number
  closed_at: number | null
  attachment_count: number
  subtask_count: number
  subtask_done: number
}

// Every read goes through this, so the counters are always present.
const TASK_SELECT = `
  SELECT tasks.*,
    (SELECT COUNT(*) FROM attachments a WHERE a.task_id = tasks.id) AS attachment_count,
    (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = tasks.id) AS subtask_count,
    (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = tasks.id AND c.status = 'done') AS subtask_done
  FROM tasks`

export const serializeTask = (t: TaskRow) => ({
  id: t.id,
  categoryId: t.category_id,
  parentId: t.parent_id,
  position: t.position,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  creatorId: t.creator_id,
  assigneeId: t.assignee_id,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  closedAt: t.closed_at,
  attachmentCount: t.attachment_count,
  subtaskCount: t.subtask_count,
  subtaskDone: t.subtask_done,
})

export const getTask = (id: number) => db.prepare(`${TASK_SELECT} WHERE tasks.id = ?`).get(id) as TaskRow | undefined

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

/** Next free slot at the end of a category (shared with sections) or of a parent's subtasks. */
export function nextPosition(categoryId: number, parentId: number | null) {
  const row = parentId
    ? db.prepare('SELECT MAX(position) AS p FROM tasks WHERE parent_id = ?').get(parentId)
    : db.prepare(`
        SELECT MAX(p) AS p FROM (
          SELECT MAX(position) AS p FROM tasks WHERE category_id = ? AND parent_id IS NULL
          UNION ALL SELECT MAX(position) FROM sections WHERE category_id = ?
        )`).get(categoryId, categoryId)
  return ((row as { p: number | null }).p ?? 0) + 1
}

export const canEdit = (req: Request, task: TaskRow) => can(req, 'edit_tasks') || task.creator_id === me(req).id
/** People working on a task: they may move it and attach files. */
export const canWork = (req: Request, task: TaskRow) => canEdit(req, task) || task.assignee_id === me(req).id

type Editable = Partial<Pick<TaskRow, 'category_id' | 'title' | 'description' | 'status' | 'priority' | 'assignee_id'>>

/** Writes changed columns, keeps closed_at in sync with status and records one audit entry. */
function applyChanges(actorId: number, task: TaskRow, next: Editable, action = 'task.updated') {
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
    if (changes.category_id) {
      // A moved task goes to the end of its new category and takes its subtasks along.
      db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(nextPosition(merged.category_id, null), task.id)
      db.prepare('UPDATE tasks SET category_id = ? WHERE parent_id = ?').run(merged.category_id, task.id)
    }
    audit(actorId, 'task', task.id, action, { title: merged.title, changes })
  })
  return getTask(task.id)!
}

tasksRouter.get('/tasks', (req, res) => {
  const where: string[] = []
  const params: SQLInputValue[] = []
  const { categoryId, assignee, status, q } = req.query

  if (typeof categoryId === 'string' && categoryId) {
    where.push('tasks.category_id = ?')
    params.push(Number(categoryId))
  }
  if (assignee === 'me') {
    where.push('tasks.assignee_id = ?')
    params.push(me(req).id)
  } else if (assignee === 'none') {
    where.push('tasks.assignee_id IS NULL')
  } else if (typeof assignee === 'string' && /^\d+$/.test(assignee)) {
    where.push('tasks.assignee_id = ?')
    params.push(Number(assignee))
  }
  if (typeof status === 'string' && (STATUSES as readonly string[]).includes(status)) {
    where.push('tasks.status = ?')
    params.push(status)
  }
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim()
    if (/^#?\d+$/.test(term)) {
      where.push('(tasks.id = ? OR tasks.title LIKE ?)')
      params.push(Number(term.replace('#', '')), `%${term}%`)
    } else {
      where.push('(tasks.title LIKE ? OR tasks.description LIKE ?)')
      params.push(`%${term}%`, `%${term}%`)
    }
  }

  const rows = db.prepare(`
    ${TASK_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE tasks.status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1 WHEN 'open' THEN 2 ELSE 3 END,
      CASE tasks.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      tasks.updated_at DESC
    LIMIT 2000
  `).all(...params) as TaskRow[]
  res.json(rows.map(serializeTask))
})

tasksRouter.get('/tasks/:id', (req, res) => {
  const task = requireTask(req)
  const history = db.prepare(`SELECT * FROM audit_log WHERE entity_type = 'task' AND entity_id = ? ORDER BY id DESC`).all(task.id) as AuditRow[]
  const subtasks = db.prepare(`${TASK_SELECT} WHERE tasks.parent_id = ? ORDER BY tasks.position`).all(task.id) as TaskRow[]
  const parent = task.parent_id ? (db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(task.parent_id) as { id: number; title: string }) : null
  res.json({
    task: serializeTask(task),
    history: history.map(serializeAudit),
    attachments: listAttachments(task.id),
    subtasks: subtasks.map(serializeTask),
    parent,
  })
})

tasksRouter.post('/tasks', requirePermission('create_tasks'), (req, res) => {
  const actor = me(req)
  const parentId = req.body?.parentId === undefined ? null : optionalId(req.body.parentId, 'Parent task')
  let categoryId: number | null

  if (parentId) {
    const parent = getTask(parentId)
    if (!parent) throw badRequest('Parent task does not exist')
    if (parent.parent_id) throw badRequest('Subtasks cannot have their own subtasks')
    categoryId = parent.category_id
  } else {
    categoryId = optionalId(req.body?.categoryId, 'Category')
    if (!categoryId) throw badRequest('Category is required')
  }
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
      INSERT INTO tasks (category_id, parent_id, position, title, description, priority, creator_id, assignee_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(categoryId, parentId, nextPosition(categoryId, parentId), title, description, priority, actor.id, assigneeId, now, now)
    const id = Number(lastInsertRowid)
    audit(actor.id, 'task', id, 'task.created', { title, categoryId, priority, assigneeId, parentId })
    if (parentId) {
      const parentTitle = (db.prepare('SELECT title FROM tasks WHERE id = ?').get(parentId) as { title: string }).title
      audit(actor.id, 'task', parentId, 'task.subtask_added', { title: parentTitle, subtaskId: id, subtaskTitle: title })
    }
    return id
  })
  res.status(201).json(serializeTask(getTask(id)!))
})

tasksRouter.patch('/tasks/:id', (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  const body = req.body ?? {}
  const next: Editable = {}

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
    if (categoryId !== task.category_id) {
      if (task.parent_id) throw badRequest('Subtasks follow their parent. Move the parent task instead.')
      assertActiveCategory(categoryId)
    }
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

  const next: Editable = { assignee_id: actor.id }
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

  const next: Editable = { assignee_id: userId }
  if (userId === null && task.status === 'in_progress') next.status = 'open'
  res.json(serializeTask(applyChanges(actor.id, task, next, userId === null ? 'task.unassigned' : 'task.assigned')))
})

tasksRouter.delete('/tasks/:id', requirePermission('delete_tasks'), (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  // Subtasks are removed together with their parent (ON DELETE CASCADE), so collect their files too.
  const files = (db.prepare('SELECT file FROM attachments WHERE task_id = ? OR task_id IN (SELECT id FROM tasks WHERE parent_id = ?)').all(task.id, task.id) as { file: string }[]).map((r) => r.file)
  transaction(() => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id)
    audit(actor.id, 'task', task.id, 'task.deleted', { title: task.title, categoryId: task.category_id, parentId: task.parent_id, subtasks: task.subtask_count })
  })
  removeFiles(files)
  res.json({ ok: true })
})
