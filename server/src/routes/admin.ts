import { Router } from 'express'
import type { SQLInputValue } from 'node:sqlite'
import { db, getSetting, setSetting, transaction } from '../db.ts'
import { audit, serializeAudit, type AuditRow } from '../audit.ts'
import { badRequest, me, oneOf, requirePermission, text, visibleCategories } from '../http.ts'

export const adminRouter = Router()

adminRouter.get('/audit', requirePermission('view_audit'), (req, res) => {
  const where: string[] = []
  const params: SQLInputValue[] = []
  const { entityType, actorId, before } = req.query

  if (typeof entityType === 'string' && entityType) {
    where.push('entity_type = ?')
    params.push(entityType)
  }
  if (typeof actorId === 'string' && /^\d+$/.test(actorId)) {
    where.push('actor_id = ?')
    params.push(Number(actorId))
  }
  if (typeof before === 'string' && /^\d+$/.test(before)) {
    where.push('id < ?')
    params.push(Number(before))
  }
  // People limited to some categories do not see the history of the others, including deleted tasks.
  const visible = visibleCategories(req)
  if (visible !== null) {
    const list = visible.length ? visible.join(',') : '0'
    where.push(`NOT (entity_type = 'category' AND entity_id NOT IN (${list}))`)
    where.push(`NOT (entity_type = 'task' AND COALESCE((SELECT t.category_id FROM tasks t WHERE t.id = audit_log.entity_id), json_extract(data, '$.categoryId'), 0) NOT IN (${list}))`)
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200)

  const rows = db.prepare(`
    SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY id DESC LIMIT ?
  `).all(...params, limit + 1) as AuditRow[]

  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(serializeAudit)
  res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null })
})

const readSettings = () => ({
  instanceName: getSetting<string>('instance_name'),
  registration: getSetting<'invite' | 'open'>('registration'),
  defaultRoleId: getSetting<number>('default_role_id'),
})

adminRouter.get('/settings', requirePermission('manage_settings'), (_req, res) => {
  res.json(readSettings())
})

adminRouter.patch('/settings', requirePermission('manage_settings'), (req, res) => {
  const actor = me(req)
  const before = readSettings()
  const next = { ...before }

  if (req.body?.instanceName !== undefined) next.instanceName = text(req.body.instanceName, 'Instance name', { min: 1, max: 40 })
  if (req.body?.registration !== undefined) next.registration = oneOf(req.body.registration, 'Registration', ['invite', 'open'] as const)
  if (req.body?.defaultRoleId !== undefined) {
    const roleId = Number(req.body.defaultRoleId)
    const role = db.prepare('SELECT is_system FROM roles WHERE id = ?').get(roleId) as { is_system: number } | undefined
    if (!role) throw badRequest('Role does not exist')
    if (role.is_system) throw badRequest('The Owner role cannot be the default role')
    next.defaultRoleId = roleId
  }

  const changes: Record<string, [unknown, unknown]> = {}
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (next[key] !== before[key]) changes[key] = [before[key], next[key]]
  }
  if (Object.keys(changes).length) {
    transaction(() => {
      setSetting('instance_name', next.instanceName)
      setSetting('registration', next.registration)
      setSetting('default_role_id', next.defaultRoleId)
      audit(actor.id, 'settings', null, 'settings.updated', { changes })
    })
  }
  res.json(readSettings())
})
