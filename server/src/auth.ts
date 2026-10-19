import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { config } from './config.ts'
import { db, getSetting, transaction } from './db.ts'
import { audit } from './audit.ts'
import { requestContext } from './context.ts'
import { HttpError } from './http.ts'
import { hasPermission } from './permissions.ts'

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
  /** Categories this user can see; null means all of them. */
  viewCategoryIds: number[] | null
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
  view_categories: string | null
}

// Only a hash of the token is stored, so a leaked database cannot be used to hijack sessions.
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const USER_COLUMNS = `
  u.id, u.discord_id, u.username, u.display_name, u.avatar, u.role_id,
  r.name AS role_name, r.color AS role_color, r.permissions, r.create_categories, r.view_categories`

const toSessionUser = (row: SessionRow): SessionUser => ({
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
  viewCategoryIds: row.view_categories === null ? null : JSON.parse(row.view_categories),
})

/** Requests the server makes to itself (MCP tools calling the API) skip the rate limit; this proves they are ours. */
export const INTERNAL_SECRET = randomBytes(24).toString('hex')

const RATE_LIMIT = 120
const RATE_WINDOW_MS = 60_000
const usage = new Map<number, { start: number; count: number }>()

function rateLimited(tokenId: number) {
  const now = Date.now()
  const slot = usage.get(tokenId)
  if (!slot || now - slot.start > RATE_WINDOW_MS) {
    usage.set(tokenId, { start: now, count: 1 })
    return false
  }
  slot.count++
  return slot.count > RATE_LIMIT
}

type TokenRow = SessionRow & { token_id: number; token_name: string; read_only: number; mark: number; last_used_at: number | null }

/** `Authorization: Bearer th_...`: a personal API token acts as its owner, with their current role. */
function tokenAuth(req: Request, header: string, next: NextFunction) {
  const token = header.slice(7).trim()
  const row = db.prepare(`
    SELECT ${USER_COLUMNS}, t.id AS token_id, t.name AS token_name, t.read_only, t.mark, t.last_used_at
    FROM api_tokens t
    JOIN users u ON u.id = t.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE t.token_hash = ? AND (t.expires_at IS NULL OR t.expires_at > ?) AND u.status = 'active'
  `).get(hashToken(token), Date.now()) as TokenRow | undefined
  if (!row) return next(new HttpError(401, 'Invalid, expired or revoked API token'))

  const user = toSessionUser(row)
  // Taking "Use the API" away from a role switches its tokens off at once.
  if (!hasPermission(user.permissions, 'use_api')) return next(new HttpError(403, 'Your role is no longer allowed to use the API'))
  if (req.get('x-taskhub-internal') !== INTERNAL_SECRET && rateLimited(row.token_id)) {
    return next(new HttpError(429, `Too many requests: at most ${RATE_LIMIT} a minute per token`))
  }
  const readOnly = Boolean(row.read_only)
  // MCP is a POST even for reading; its write tools are hidden, and their API calls are checked here again.
  if (readOnly && !['GET', 'HEAD'].includes(req.method) && req.path !== '/api/mcp') return next(new HttpError(403, 'This API token is read-only'))

  if (!row.last_used_at || Date.now() - row.last_used_at > 60_000) db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.token_id)
  req.user = user
  req.apiToken = { id: row.token_id, name: row.token_name, readOnly }
  // An unmarked token only stays unmarked while its owner is an administrator.
  if (row.mark || !user.permissions.includes('admin')) requestContext.run({ via: row.token_name }, next)
  else next()
}

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization')
  if (header && /^bearer th_/i.test(header)) return tokenAuth(req, header, next)
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token === 'string' && token) {
    const row = db.prepare(`
      SELECT ${USER_COLUMNS}
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE s.token = ? AND s.expires_at > ? AND u.status = 'active'
    `).get(hashToken(token), Date.now()) as SessionRow | undefined

    if (row) req.user = toSessionUser(row)
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
        UPDATE users SET username = ?, display_name = ?, avatar = ?, status = 'active', last_login_at = ?, joined_at = COALESCE(joined_at, ?)
        WHERE id = ?
      `).run(profile.username, profile.displayName, profile.avatar, now, now, existing.id)
      if (existing.status === 'invited') audit(existing.id, 'user', existing.id, 'user.activated', { name: profile.displayName })
      return { userId: existing.id }
    }

    const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    const isFirst = count === 0
    if (!isFirst && getSetting<string>('registration') !== 'open') return { error: 'not_invited' as const }

    const roleId = isFirst ? 1 : getSetting<number>('default_role_id')
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users (discord_id, username, display_name, avatar, role_id, status, created_at, last_login_at, joined_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(profile.id, profile.username, profile.displayName, profile.avatar, roleId, now, now, now)
    const userId = Number(lastInsertRowid)
    audit(userId, 'user', userId, isFirst ? 'user.bootstrap' : 'user.joined', { name: profile.displayName })
    return { userId }
  })
}
