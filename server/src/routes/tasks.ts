import { Router, type Request } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { db, transaction } from '../db.ts'
import { audit, diff, serializeAudit, type AuditRow } from '../audit.ts'
import { badRequest, can, canSeeCategory, forbidden, idParam, me, notFound, oneOf, optionalId, requirePermission, text, visibilityFilter } from '../http.ts'
import { listAttachments, removeFiles } from './attachments.ts'
import { canCreateIn } from '../permissions.ts'
import { parseLabelIds } from './labels.ts'
import { parsePriorityId } from './priorities.ts'

export const tasksRouter = Router()

export const STATUSES = ['open', 'in_progress', 'review', 'done'] as const

export type TaskRow = {
  id: number
  category_id: number
  parent_id: number | null
  position: number
  title: string
  description: string
  status: (typeof STATUSES)[number]
  priority_id: number
  creator_id: number | null
  assignee_id: number | null
  created_at: number
  updated_at: number
  closed_at: number | null
  archived_at: number | null
  due_date: string | null
  label_ids: string | null
  attachment_count: number
  subtask_count: number
  subtask_done: number
}

// Every read goes through this, so the counters are always present.
const TASK_SELECT = `
  SELECT tasks.*,
    (SELECT COUNT(*) FROM attachments a WHERE a.task_id = tasks.id) AS attachment_count,
    (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = tasks.id AND c.archived_at IS NULL) AS subtask_count,
    (SELECT COUNT(*) FROM tasks c WHERE c.parent_id = tasks.id AND c.archived_at IS NULL AND c.status = 'done') AS subtask_done,
    (SELECT group_concat(tl.label_id) FROM task_labels tl WHERE tl.task_id = tasks.id) AS label_ids
  FROM tasks`

export const serializeTask = (t: TaskRow) => ({
  id: t.id,
  categoryId: t.category_id,
  parentId: t.parent_id,
  position: t.position,
  title: t.title,
  description: t.description,
  status: t.status,
  priorityId: t.priority_id,
  creatorId: t.creator_id,
  assigneeId: t.assignee_id,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  closedAt: t.closed_at,
  archivedAt: t.archived_at,
  dueDate: t.due_date,
  labelIds: t.label_ids ? t.label_ids.split(',').map(Number).sort((a, b) => a - b) : [],
  attachmentCount: t.attachment_count,
  subtaskCount: t.subtask_count,
  subtaskDone: t.subtask_done,
})

export const getTask = (id: number) => db.prepare(`${TASK_SELECT} WHERE tasks.id = ?`).get(id) as TaskRow | undefined

export function requireTask(req: Request) {
  const task = getTask(idParam(req))
  // Tasks in categories the user cannot see behave as if they did not exist.
  if (!task || !canSeeCategory(req, task.category_id)) throw notFound('Task not found')
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

type Editable = Partial<Pick<TaskRow, 'category_id' | 'title' | 'description' | 'status' | 'priority_id' | 'assignee_id' | 'due_date'>>

/** null, or a real calendar day written as YYYY-MM-DD. */
function parseDueDate(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest('Due date must look like 2026-10-31')
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw badRequest('Due date is not a real date')
  return value
}

const currentLabels = (taskId: number) =>
  (db.prepare('SELECT label_id FROM task_labels WHERE task_id = ? ORDER BY label_id').all(taskId) as { label_id: number }[]).map((r) => r.label_id)

/** Writes changed columns and labels, keeps closed_at in sync with status and records one audit entry. */
function applyChanges(actorId: number, task: TaskRow, next: Editable, action = 'task.updated', labels?: number[]) {
  const changes = diff(task, next)
  const before = labels ? currentLabels(task.id) : []
  if (labels && before.join() !== labels.join()) changes.labels = [before, labels]
  if (!Object.keys(changes).length) return task

  const merged = { ...task, ...next }
  const now = Date.now()
  if (changes.status) merged.closed_at = merged.status === 'done' ? now : null

  transaction(() => {
    db.prepare(`
      UPDATE tasks SET category_id = ?, title = ?, description = ?, status = ?, priority_id = ?, assignee_id = ?, due_date = ?, updated_at = ?, closed_at = ?
      WHERE id = ?
    `).run(merged.category_id, merged.title, merged.description, merged.status, merged.priority_id, merged.assignee_id, merged.due_date, now, merged.closed_at, task.id)
    if (changes.labels) {
      db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(task.id)
      for (const id of labels!) db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(task.id, id)
    }
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
  const { categoryId, assignee, status, q, archived, label } = req.query
  const showArchived = archived === '1'
  where.push(showArchived ? 'tasks.archived_at IS NOT NULL' : 'tasks.archived_at IS NULL')
  const visible = visibilityFilter(req, 'tasks.category_id')
  if (visible.sql) {
    where.push(visible.sql.replace(/^ AND /, ''))
    params.push(...visible.params)
  }

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
  if (typeof label === 'string' && /^\d+$/.test(label)) {
    where.push('tasks.id IN (SELECT task_id FROM task_labels WHERE label_id = ?)')
    params.push(Number(label))
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
      ${showArchived ? 'tasks.archived_at DESC,' : ''}
      CASE tasks.status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1 WHEN 'open' THEN 2 ELSE 3 END,
      (SELECT p.position FROM priorities p WHERE p.id = tasks.priority_id),
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
    if (!parent || !canSeeCategory(req, parent.category_id)) throw badRequest('Parent task does not exist')
    if (parent.parent_id) throw badRequest('Subtasks cannot have their own subtasks')
    if (parent.archived_at) throw badRequest('Restore the parent task before adding subtasks')
    categoryId = parent.category_id
  } else {
    categoryId = optionalId(req.body?.categoryId, 'Category')
    if (!categoryId) throw badRequest('Category is required')
    if (!canSeeCategory(req, categoryId)) throw badRequest('Category does not exist')
  }
  assertActiveCategory(categoryId)
  if (!canCreateIn(actor.permissions, actor.createCategoryIds, categoryId)) throw forbidden('Your role cannot create tasks in this category')

  const title = text(req.body?.title, 'Title', { min: 1, max: 200 })
  const description = text(req.body?.description ?? '', 'Description', { max: 20000 })
  const priorityId = parsePriorityId(req.body?.priorityId)
  const assigneeId = req.body?.assigneeId === undefined ? null : optionalId(req.body.assigneeId, 'Assignee')
  const dueDate = req.body?.dueDate === undefined ? null : parseDueDate(req.body.dueDate)
  const labelIds = req.body?.labelIds === undefined ? [] : parseLabelIds(req.body.labelIds)
  if (assigneeId !== null) {
    const selfTake = assigneeId === actor.id && can(req, 'take_tasks')
    if (!selfTake && !can(req, 'assign_tasks')) throw forbidden('You cannot assign tasks')
    assertAssignable(assigneeId)
  }

  const id = transaction(() => {
    const now = Date.now()
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO tasks (category_id, parent_id, position, title, description, priority_id, creator_id, assignee_id, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(categoryId, parentId, nextPosition(categoryId, parentId), title, description, priorityId, actor.id, assigneeId, dueDate, now, now)
    const id = Number(lastInsertRowid)
    for (const labelId of labelIds) db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(id, labelId)
    audit(actor.id, 'task', id, 'task.created', { title, categoryId, priorityId, assigneeId, parentId })
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

  const editsContent = ['title', 'description', 'priorityId', 'categoryId', 'dueDate', 'labelIds'].some((k) => body[k] !== undefined)
  if (editsContent && !canEdit(req, task)) throw forbidden('Only the author or someone with "Edit any task" can edit this task')
  if (body.status !== undefined && !canWork(req, task)) throw forbidden('Only the assignee, the author or an editor can change the status')

  if (body.title !== undefined) next.title = text(body.title, 'Title', { min: 1, max: 200 })
  if (body.description !== undefined) next.description = text(body.description, 'Description', { max: 20000 })
  if (body.priorityId !== undefined) next.priority_id = parsePriorityId(body.priorityId)
  if (body.status !== undefined) next.status = oneOf(body.status, 'Status', STATUSES)
  if (body.dueDate !== undefined) next.due_date = parseDueDate(body.dueDate)
  const labels = body.labelIds === undefined ? undefined : parseLabelIds(body.labelIds)
  if (body.categoryId !== undefined) {
    const categoryId = optionalId(body.categoryId, 'Category')
    if (!categoryId) throw badRequest('Category is required')
    if (categoryId !== task.category_id) {
      if (task.parent_id) throw badRequest('Subtasks follow their parent. Move the parent task instead.')
      if (!canSeeCategory(req, categoryId)) throw badRequest('Category does not exist')
      assertActiveCategory(categoryId)
      // Moving a task somewhere is as good as creating it there, unless you may edit any task anyway.
      if (!can(req, 'edit_tasks') && !canCreateIn(actor.permissions, actor.createCategoryIds, categoryId)) {
        throw forbidden('Your role cannot add tasks to that category')
      }
    }
    next.category_id = categoryId
  }

  res.json(serializeTask(applyChanges(actor.id, task, next, 'task.updated', labels)))
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

/** Archiving takes the subtasks along; restoring brings back the ones that were archived with it. */
tasksRouter.post('/tasks/:id/archive', (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  if (!canEdit(req, task)) throw forbidden('Only the author or someone with "Edit any task" can archive this task')
  const archive = Boolean(req.body?.archived)
  if (archive === Boolean(task.archived_at)) return res.json(serializeTask(task))
  if (!archive && task.parent_id && getTask(task.parent_id)?.archived_at) throw badRequest('Restore the parent task first')

  transaction(() => {
    if (archive) {
      db.prepare('UPDATE tasks SET archived_at = ? WHERE id = ? OR (parent_id = ? AND archived_at IS NULL)').run(Date.now(), task.id, task.id)
    } else {
      db.prepare('UPDATE tasks SET archived_at = NULL WHERE parent_id = ? AND archived_at = ?').run(task.id, task.archived_at)
      db.prepare('UPDATE tasks SET archived_at = NULL WHERE id = ?').run(task.id)
    }
    audit(actor.id, 'task', task.id, archive ? 'task.archived' : 'task.unarchived', { title: task.title })
  })
  res.json(serializeTask(getTask(task.id)!))
})

tasksRouter.delete('/tasks/:id', (req, res) => {
  const actor = me(req)
  const task = requireTask(req)
  if (!can(req, 'delete_tasks')) {
    if (!can(req, 'delete_own_tasks') || task.creator_id !== actor.id) throw forbidden('You can only delete tasks you created')
    // Deleting your task must not take other people's subtasks with it.
    const foreign = db.prepare('SELECT 1 FROM tasks WHERE parent_id = ? AND (creator_id IS NOT ? )').get(task.id, actor.id)
    if (foreign) throw forbidden('This task has subtasks created by others. Ask someone who can delete any task.')
  }
  // Subtasks are removed together with their parent (ON DELETE CASCADE), so collect their files too.
  const files = (db.prepare('SELECT file FROM attachments WHERE task_id = ? OR task_id IN (SELECT id FROM tasks WHERE parent_id = ?)').all(task.id, task.id) as { file: string }[]).map((r) => r.file)
  transaction(() => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id)
    audit(actor.id, 'task', task.id, 'task.deleted', { title: task.title, categoryId: task.category_id, parentId: task.parent_id, subtasks: task.subtask_count })
  })
  removeFiles(files)
  res.json({ ok: true })
})
