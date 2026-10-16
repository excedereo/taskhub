import { Router } from 'express'
import { db, getSetting, transaction } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { covers, isPermission } from '../permissions.ts'
import { badRequest, forbidden, idParam, me, notFound, requirePermission, text } from '../http.ts'

export const rolesRouter = Router()

type RoleRow = {
  id: number
  name: string
  color: string | null
  permissions: string
  is_system: number
  created_at: number
  member_count: number
}

const serializeRole = (r: RoleRow, defaultRoleId: number) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  permissions: JSON.parse(r.permissions) as string[],
  isSystem: Boolean(r.is_system),
  isDefault: r.id === defaultRoleId,
  memberCount: r.member_count,
})

const ROLE_SELECT = `
  SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.status != 'disabled') AS member_count
  FROM roles r`

const getRole = (id: number) => db.prepare(`${ROLE_SELECT} WHERE r.id = ?`).get(id) as RoleRow | undefined

rolesRouter.get('/roles', (_req, res) => {
  const rows = db.prepare(`${ROLE_SELECT} ORDER BY r.is_system DESC, r.id`).all() as RoleRow[]
  const defaultRoleId = getSetting<number>('default_role_id')
  res.json(rows.map((r) => serializeRole(r, defaultRoleId)))
})

function parseColor(value: unknown): string | null {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw badRequest('Color must be a hex value like #3b82f6')
  return value.toLowerCase()
}

function parsePermissions(value: unknown, actorPerms: string[]): string[] {
  if (!Array.isArray(value) || !value.every(isPermission)) throw badRequest('Unknown permission in list')
  const perms = [...new Set(value)]
  if (!covers(actorPerms, perms)) throw forbidden('You can only grant permissions you have yourself')
  return perms
}

function assertNameFree(name: string, exceptId = 0) {
  if (db.prepare('SELECT 1 FROM roles WHERE name = ? AND id != ?').get(name, exceptId)) throw badRequest('A role with this name already exists')
}

rolesRouter.post('/roles', requirePermission('manage_roles'), (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 32 })
  const color = parseColor(req.body?.color ?? null)
  const permissions = parsePermissions(req.body?.permissions ?? [], actor.permissions)
  assertNameFree(name)

  const id = transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO roles (name, color, permissions, created_at) VALUES (?, ?, ?, ?)')
      .run(name, color, JSON.stringify(permissions), Date.now())
    const id = Number(lastInsertRowid)
    audit(actor.id, 'role', id, 'role.created', { name, permissions })
    return id
  })
  res.status(201).json(serializeRole(getRole(id)!, getSetting<number>('default_role_id')))
})

rolesRouter.patch('/roles/:id', requirePermission('manage_roles'), (req, res) => {
  const actor = me(req)
  const role = getRole(idParam(req))
  if (!role) throw notFound('Role not found')
  if (role.is_system) throw forbidden('The Owner role cannot be changed')
  const current: string[] = JSON.parse(role.permissions)
  if (!covers(actor.permissions, current)) throw forbidden('This role has permissions you do not have')

  const next: { name?: string; color?: string | null; permissions?: string } = {}
  if (req.body?.name !== undefined) {
    next.name = text(req.body.name, 'Name', { min: 1, max: 32 })
    assertNameFree(next.name, role.id)
  }
  if (req.body?.color !== undefined) next.color = parseColor(req.body.color)
  if (req.body?.permissions !== undefined) {
    // Editing your own role could lock you (and possibly everyone) out.
    if (role.id === actor.roleId) throw forbidden('You cannot change permissions of your own role')
    next.permissions = JSON.stringify(parsePermissions(req.body.permissions, actor.permissions).sort())
    if (next.permissions === JSON.stringify([...current].sort())) delete next.permissions
  }

  const changes = diff(role, next)
  if (Object.keys(changes).length) {
    if (changes.permissions) changes.permissions = [current, JSON.parse(next.permissions!)]
    transaction(() => {
      db.prepare('UPDATE roles SET name = ?, color = ?, permissions = ? WHERE id = ?')
        .run(next.name ?? role.name, next.color === undefined ? role.color : next.color, next.permissions ?? role.permissions, role.id)
      audit(actor.id, 'role', role.id, 'role.updated', { name: next.name ?? role.name, changes })
    })
  }
  res.json(serializeRole(getRole(role.id)!, getSetting<number>('default_role_id')))
})

rolesRouter.delete('/roles/:id', requirePermission('manage_roles'), (req, res) => {
  const actor = me(req)
  const role = getRole(idParam(req))
  if (!role) throw notFound('Role not found')
  if (role.is_system) throw forbidden('The Owner role cannot be deleted')
  const defaultRoleId = getSetting<number>('default_role_id')
  if (role.id === defaultRoleId) throw badRequest('This is the default role. Pick another default in Settings first.')
  if (role.id === actor.roleId) throw forbidden('You cannot delete your own role')
  if (!covers(actor.permissions, JSON.parse(role.permissions))) throw forbidden('This role has permissions you do not have')

  transaction(() => {
    const moved = db.prepare('UPDATE users SET role_id = ? WHERE role_id = ?').run(defaultRoleId, role.id).changes
    db.prepare('DELETE FROM roles WHERE id = ?').run(role.id)
    audit(actor.id, 'role', role.id, 'role.deleted', { name: role.name, movedUsers: Number(moved) })
  })
  res.json({ ok: true })
})
