import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { config } from './config.ts'
import { db, getSetting, transaction } from './db.ts'
import { audit } from './audit.ts'

export const SESSION_COOKIE = 'taskhub_session'

export type SessionUser = {
  id: number
  discordId: string
  username: string | null
  displayName: string | null
  avatar: string | null
  roleId: number
  roleName: string
  roleColor: string | null
  permissions: string[]
  /** Categories this user may create tasks in; null means all of them. */
  createCategoryIds: number[] | null
}

type SessionRow = {
  id: number
  discord_id: string
  username: string | null
  display_name: string | null
  avatar: string | null
  role_id: number
  role_name: string
  role_color: string | null
  permissions: string
  create_categories: string | null
}

// Only a hash of the token is stored, so a leaked database cannot be used to hijack sessions.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token === 'string' && token) {
    const row = db.prepare(`
      SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar, u.role_id,
             r.name AS role_name, r.color AS role_color, r.permissions, r.create_categories
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE s.token = ? AND s.expires_at > ? AND u.status = 'active'
    `).get(hashToken(token), Date.now()) as SessionRow | undefined

    if (row) {
      req.user = {
        id: row.id,
        discordId: row.discord_id,
        username: row.username,
        displayName: row.display_name,
        avatar: row.avatar,
        roleId: row.role_id,
        roleName: row.role_name,
        roleColor: row.role_color,
        permissions: JSON.parse(row.permissions),
        createCategoryIds: row.create_categories === null ? null : JSON.parse(row.create_categories),
      }
    }
  }
  next()
}

export function startSession(res: Response, userId: number) {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const maxAge = config.sessionDays * 24 * 60 * 60 * 1000
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now, now + maxAge)
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge, path: '/' })
}

export function endSession(req: Request, res: Response) {
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token))
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export function endAllSessions(userId: number) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function pruneSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
}

export type DiscordProfile = {
  id: string
  username: string
  displayName: string
  avatar: string | null
}

export type SignInError = 'not_invited' | 'disabled'

type ExistingUser = { id: number; status: 'invited' | 'active' | 'disabled' }

/**
 * Resolves a Discord profile to a local user.
 * The very first person to sign in becomes the Owner, everyone after that
 * must be added by a user manager, unless registration is set to open.
 */
export function signIn(profile: DiscordProfile): { userId: number } | { error: SignInError } {
  return transaction(() => {
    const now = Date.now()
    const existing = db.prepare('SELECT id, status FROM users WHERE discord_id = ?').get(profile.id) as ExistingUser | undefined

    if (existing) {
      if (existing.status === 'disabled') return { error: 'disabled' as const }
      db.prepare(`
        UPDATE users SET username = ?, display_name = ?, avatar = ?, status = 'active', last_login_at = ?
        WHERE id = ?
      `).run(profile.username, profile.displayName, profile.avatar, now, existing.id)
      if (existing.status === 'invited') audit(existing.id, 'user', existing.id, 'user.activated', { name: profile.displayName })
      return { userId: existing.id }
    }

    const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    const isFirst = count === 0
    if (!isFirst && getSetting<string>('registration') !== 'open') return { error: 'not_invited' as const }

    const roleId = isFirst ? 1 : getSetting<number>('default_role_id')
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users (discord_id, username, display_name, avatar, role_id, status, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(profile.id, profile.username, profile.displayName, profile.avatar, roleId, now, now)
    const userId = Number(lastInsertRowid)
    audit(userId, 'user', userId, isFirst ? 'user.bootstrap' : 'user.joined', { name: profile.displayName })
    return { userId }
  })
}
