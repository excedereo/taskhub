import { randomBytes } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { db } from '../db.ts'
import { audit } from '../audit.ts'
import { hashToken } from '../auth.ts'
import { forbidden, idParam, me, notFound, requirePermission, text, badRequest } from '../http.ts'

export const tokensRouter = Router()

type TokenRow = { id: number; user_id: number; name: string; hint: string; read_only: number; expires_at: number | null; last_used_at: number | null; created_at: number }

const serialize = (t: TokenRow) => ({
  id: t.id,
  name: t.name,
  hint: t.hint,
  readOnly: Boolean(t.read_only),
  expiresAt: t.expires_at,
  lastUsedAt: t.last_used_at,
  createdAt: t.created_at,
})

const MAX_TOKENS = 20
const EXPIRY_DAYS = [7, 30, 90, 365]

/** Tokens are managed from the browser only: a leaked token must not be able to mint more of itself. */
function browserOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.apiToken) return next(forbidden('API tokens cannot manage API tokens. Use the website.'))
  next()
}

tokensRouter.use('/me/tokens', requirePermission('use_api'), browserOnly)

tokensRouter.get('/me/tokens', (req, res) => {
  const rows = db.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(me(req).id) as TokenRow[]
  res.json(rows.map(serialize))
})

tokensRouter.post('/me/tokens', (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 40 })
  const readOnly = Boolean(req.body?.readOnly)
  const days = req.body?.expiresInDays ?? null
  if (days !== null && !EXPIRY_DAYS.includes(days)) throw badRequest(`Expiry must be one of ${EXPIRY_DAYS.join(', ')} days, or never`)
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?').get(actor.id) as { n: number }
  if (n >= MAX_TOKENS) throw badRequest(`You already have ${MAX_TOKENS} tokens. Revoke one you no longer use.`)

  // "th_" makes tokens easy to recognise (and to find if one is pasted somewhere it should not be).
  const token = `th_${randomBytes(24).toString('base64url')}`
  const now = Date.now()
  const { lastInsertRowid } = db.prepare('INSERT INTO api_tokens (user_id, name, token_hash, hint, read_only, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(actor.id, name, hashToken(token), token.slice(-4), readOnly ? 1 : 0, days === null ? null : now + days * 86_400_000, now)
  audit(actor.id, 'user', actor.id, 'user.token_created', { name: actor.displayName ?? actor.username, token: name, readOnly })
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(Number(lastInsertRowid)) as TokenRow
  // The only time the token itself is ever shown.
  res.status(201).json({ ...serialize(row), token })
})

tokensRouter.delete('/me/tokens/:id', (req, res) => {
  const actor = me(req)
  const row = db.prepare('SELECT * FROM api_tokens WHERE id = ? AND user_id = ?').get(idParam(req), actor.id) as TokenRow | undefined
  if (!row) throw notFound('Token not found')
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(row.id)
  audit(actor.id, 'user', actor.id, 'user.token_revoked', { name: actor.displayName ?? actor.username, token: row.name })
  res.status(204).end()
})
