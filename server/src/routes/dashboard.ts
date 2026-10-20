import { Router } from 'express'
import { db, getSetting, setSetting } from '../db.ts'
import { audit } from '../audit.ts'
import { badRequest, me, requirePermission, visibleCategories, visibilityFilter } from '../http.ts'

export const dashboardRouter = Router()

/** Widget kinds the dashboard knows; their settings are free-form and read by the page. */
const TYPES = ['number', 'countdown', 'deadlines', 'breakdown', 'progress', 'timeline', 'honeycomb', 'activity', 'stuck', 'workload', 'note'] as const
const SIZES = ['quarter', 'half', 'full'] as const
const ACTIVITY_DAYS = 26 * 7

type Widget = { id: string; type: (typeof TYPES)[number]; size: (typeof SIZES)[number]; config: Record<string, unknown> }

/** The layout a new workspace starts with: what the old Analytics page showed, plus deadlines. */
const DEFAULT_LAYOUT: Widget[] = [
  { id: 'open', type: 'number', size: 'quarter', config: { metric: 'open', label: 'Unfinished' } },
  { id: 'active', type: 'number', size: 'quarter', config: { metric: 'active', label: 'In progress' } },
  { id: 'closed', type: 'number', size: 'quarter', config: { metric: 'closed', label: 'Finished' } },
  { id: 'overdue', type: 'number', size: 'quarter', config: { metric: 'overdue', label: 'Overdue' } },
  { id: 'countdown', type: 'countdown', size: 'half', config: { target: 'deadline', title: 'Next deadline' } },
  { id: 'deadlines', type: 'deadlines', size: 'half', config: {} },
  { id: 'by-category', type: 'breakdown', size: 'half', config: { by: 'category', chart: 'donut', title: 'Unfinished by category' } },
  { id: 'progress', type: 'progress', size: 'half', config: {} },
  { id: 'timeline', type: 'timeline', size: 'full', config: {} },
  { id: 'stuck', type: 'stuck', size: 'full', config: {} },
  { id: 'workload', type: 'workload', size: 'full', config: {} },
]

function readLayout(): Widget[] {
  return getSetting<Widget[] | null>('dashboard') ?? DEFAULT_LAYOUT
}

function parseLayout(value: unknown): Widget[] {
  if (!Array.isArray(value) || value.length > 40) throw badRequest('A dashboard is a list of at most 40 widgets')
  const ids = new Set<string>()
  return value.map((w) => {
    const v = (w ?? {}) as Partial<Widget>
    if (typeof v.id !== 'string' || !/^[\w-]{1,40}$/.test(v.id) || ids.has(v.id)) throw badRequest('Every widget needs its own id')
    ids.add(v.id)
    if (!TYPES.includes(v.type as Widget['type'])) throw badRequest(`Unknown widget type "${String(v.type)}"`)
    if (!SIZES.includes(v.size as Widget['size'])) throw badRequest('Widget size must be quarter, half or full')
    const config = v.config && typeof v.config === 'object' && !Array.isArray(v.config) ? v.config : {}
    if (JSON.stringify(config).length > 4000) throw badRequest('Widget settings are too long')
    return { id: v.id, type: v.type as Widget['type'], size: v.size as Widget['size'], config }
  })
}

dashboardRouter.get('/dashboard', (_req, res) => {
  res.json({ widgets: readLayout(), custom: getSetting('dashboard') !== null })
})

dashboardRouter.put('/dashboard', requirePermission('manage_dashboard'), (req, res) => {
  const actor = me(req)
  // null goes back to the default layout.
  const widgets = req.body?.widgets === null ? null : parseLayout(req.body?.widgets)
  setSetting('dashboard', widgets)
  audit(actor.id, 'settings', null, 'settings.dashboard', { count: widgets?.length ?? DEFAULT_LAYOUT.length, reset: widgets === null })
  res.json({ widgets: readLayout(), custom: widgets !== null })
})

type TaskRow = {
  id: number
  category_id: number
  parent_id: number | null
  position: number
  title: string
  status_id: number
  priority_id: number
  assignee_id: number | null
  creator_id: number | null
  due_date: string | null
  created_at: number
  updated_at: number
  closed_at: number | null
  archived_at: number | null
  label_ids: string | null
}

/**
 * Everything the widgets count, in one compact answer: the tasks this person can see (archived ones
 * too, so history does not change when old work is archived), sections, and when changes happened.
 */
dashboardRouter.get('/dashboard/data', (req, res) => {
  const visible = visibilityFilter(req, 't.category_id')
  const tasks = db.prepare(`
    SELECT t.id, t.category_id, t.parent_id, t.position, t.title, t.status_id, t.priority_id, t.assignee_id, t.creator_id,
           t.due_date, t.created_at, t.updated_at, t.closed_at, t.archived_at,
           (SELECT group_concat(tl.label_id) FROM task_labels tl WHERE tl.task_id = t.id) AS label_ids
    FROM tasks t
    JOIN categories c ON c.id = t.category_id
    WHERE c.archived = 0${visible.sql}
  `).all(...visible.params) as TaskRow[]

  const ids = visibleCategories(req)
  const sections = (db.prepare('SELECT id, category_id, title, position FROM sections ORDER BY position').all() as { id: number; category_id: number; title: string; position: number }[])
    .filter((s) => ids === null || ids.includes(s.category_id))
    .map((s) => ({ id: s.id, categoryId: s.category_id, title: s.title, position: s.position }))

  // Changes to visible tasks, as bare timestamps: the page buckets them into days in the viewer's time zone.
  const since = Date.now() - ACTIVITY_DAYS * 86_400_000
  const activity = (db.prepare(`
    SELECT a.created_at FROM audit_log a
    WHERE a.entity_type = 'task' AND a.created_at >= ?
      AND COALESCE((SELECT t.category_id FROM tasks t WHERE t.id = a.entity_id), json_extract(a.data, '$.categoryId'), 0) IN (
        SELECT c.id FROM categories c WHERE 1${ids === null ? '' : ids.length ? ` AND c.id IN (${ids.join(',')})` : ' AND 0'}
      )
  `).all(since) as { created_at: number }[]).map((r) => r.created_at)

  res.json({
    now: Date.now(),
    tasks: tasks.map((t) => ({
      id: t.id,
      categoryId: t.category_id,
      parentId: t.parent_id,
      position: t.position,
      title: t.title,
      statusId: t.status_id,
      priorityId: t.priority_id,
      assigneeId: t.assignee_id,
      creatorId: t.creator_id,
      labelIds: t.label_ids ? t.label_ids.split(',').map(Number) : [],
      dueDate: t.due_date,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      closedAt: t.closed_at,
      archivedAt: t.archived_at,
    })),
    sections,
    activity,
  })
})
