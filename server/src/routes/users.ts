import { Router } from 'express'
import { db, getSetting, transaction } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { endAllSessions } from '../auth.ts'
import { covers } from '../permissions.ts'
import { badRequest, forbidden, idParam, me, notFound, oneOf, requirePermission, text } from '../http.ts'

export const usersRouter = Router()

type UserRow = {
  id: number
  discord_id: string
  username: string | null
  display_name: string | null
  avatar: string | null
  role_id: number
  status: 'invited' | 'active' | 'disabled'
  created_at: number
  last_login_at: number | null
  joined_at: number | null
}

export const serializeUser = (u: UserRow) => ({
  id: u.id,
  discordId: u.discord_id,
  username: u.username,
  displayName: u.display_name,
  avatar: u.avatar,
  roleId: u.role_id,
  status: u.status,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at,
  joinedAt: u.joined_at,
})

const getUser = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined

export function rolePermissions(roleId: number): string[] | undefined {
  const row = db.prepare('SELECT permissions FROM roles WHERE id = ?').get(roleId) as { permissions: string } | undefined
  return row ? JSON.parse(row.permissions) : undefined
}

const userName = (u: UserRow) => u.display_name ?? u.username ?? u.discord_id

// Everyone signed in can see the team: it is needed to pick assignees and show authors.
usersRouter.get('/users', (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY status = \'disabled\', COALESCE(display_name, username, discord_id) COLLATE NOCASE').all() as UserRow[]
  res.json(rows.map(serializeUser))
})

/** A manager may only hand out roles whose permissions they hold themselves. */
function assertCanGrant(actorPerms: string[], roleId: number) {
  const perms = rolePermissions(roleId)
  if (!perms) throw badRequest('Role does not exist')
  if (!covers(actorPerms, perms)) throw forbidden('That role has permissions you do not have')
}

usersRouter.post('/users', requirePermission('manage_users'), (req, res) => {
  const actor = me(req)
  const discordId = text(req.body?.discordId, 'Discord ID', { min: 1, max: 20 })
  if (!/^\d{15,20}$/.test(discordId)) throw badRequest('Discord ID is a 15–20 digit number. Enable Developer Mode in Discord and use "Copy User ID".')
  const roleId = req.body?.roleId === undefined ? getSetting<number>('default_role_id') : Number(req.body.roleId)
  assertCanGrant(actor.permissions, roleId)

  if (db.prepare('SELECT 1 FROM users WHERE discord_id = ?').get(discordId)) throw badRequest('This Discord user is already added')

  const user = transaction(() => {
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (discord_id, role_id, status, created_at) VALUES (?, ?, 'invited', ?)`)
      .run(discordId, roleId, Date.now())
    const id = Number(lastInsertRowid)
    audit(actor.id, 'user', id, 'user.invited', { name: discordId, roleId })
    return getUser(id)!
  })
  res.status(201).json(serializeUser(user))
})

usersRouter.patch('/users/:id', requirePermission('manage_users'), (req, res) => {
  const actor = me(req)
  const target = getUser(idParam(req))
  if (!target) throw notFound('User not found')
  if (target.id === actor.id) throw forbidden('You cannot change your own role or status')
  if (!covers(actor.permissions, rolePermissions(target.role_id) ?? [])) throw forbidden('This user has permissions you do not have')

  const next: { role_id?: number; status?: UserRow['status'] } = {}
  if (req.body?.roleId !== undefined) {
    next.role_id = Number(req.body.roleId)
    assertCanGrant(actor.permissions, next.role_id)
  }
  if (req.body?.status !== undefined) {
    const status = oneOf(req.body.status, 'Status', ['active', 'disabled'] as const)
    // Re-enabled accounts that never signed in go back to "invited".
    next.status = status === 'disabled' ? 'disabled' : target.last_login_at ? 'active' : 'invited'
  }

  const changes = diff(target, next)
  if (Object.keys(changes).length) {
    transaction(() => {
      db.prepare('UPDATE users SET role_id = ?, status = ? WHERE id = ?')
        .run(next.role_id ?? target.role_id, next.status ?? target.status, target.id)
      audit(actor.id, 'user', target.id, 'user.updated', { name: userName(target), changes })
    })
    if (next.status === 'disabled') endAllSessions(target.id)
  }
  res.json(serializeUser(getUser(target.id)!))
})

// Only accounts that never signed in can be removed; active ones are disabled to keep history intact.
usersRouter.delete('/users/:id', requirePermission('manage_users'), (req, res) => {
  const actor = me(req)
  const target = getUser(idParam(req))
  if (!target) throw notFound('User not found')
  if (target.status !== 'invited') throw badRequest('Only invitations can be removed. Disable the account instead.')

  transaction(() => {
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id)
    audit(actor.id, 'user', target.id, 'user.removed', { name: userName(target) })
  })
  res.json({ ok: true })
})
