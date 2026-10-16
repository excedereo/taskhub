import { Router, type Request } from 'express'
import { db } from '../db.ts'
import { audit, diff } from '../audit.ts'
import { badRequest, idParam, me, notFound, requirePermission, text, visibleCategories } from '../http.ts'
import { limitWithin } from '../permissions.ts'
import { EVENT_GROUPS, EVENT_KINDS, sendToDiscord, type WebhookRow } from '../integrations.ts'

export const integrationsRouter = Router()

integrationsRouter.use('/integrations', requirePermission('manage_integrations'))

// Only real Discord webhook URLs, so the server never posts anywhere else.
const WEBHOOK_URL = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)$/

function parseUrl(value: unknown) {
  const url = text(value, 'Webhook URL', { min: 1, max: 300 })
  if (!WEBHOOK_URL.test(url)) throw badRequest('Paste a Discord webhook URL: Channel settings → Integrations → Webhooks → Copy Webhook URL')
  return url
}

/** The token part is a secret: once saved, only the start of the URL is shown. */
const maskUrl = (url: string) => url.replace(WEBHOOK_URL, (_m, id: string) => `discord.com/api/webhooks/${id}/••••••`)

const serialize = (w: WebhookRow) => ({
  id: w.id,
  name: w.name,
  url: maskUrl(w.url),
  events: w.events ? (JSON.parse(w.events) as string[]) : null,
  categories: w.categories ? (JSON.parse(w.categories) as number[]) : null,
  enabled: Boolean(w.enabled),
  lastError: w.last_error,
  lastSentAt: w.last_sent_at,
  queued: (db.prepare('SELECT COUNT(*) AS n FROM webhook_queue WHERE webhook_id = ?').get(w.id) as { n: number }).n,
  createdAt: w.created_at,
})

function parseEvents(value: unknown): string[] | null {
  if (value === null) return null
  if (!Array.isArray(value) || !value.every((k) => typeof k === 'string' && EVENT_KINDS.includes(k))) throw badRequest('Unknown event kind')
  return [...new Set(value as string[])]
}

/** null (every category) or a list; people limited to some categories cannot send the others' events anywhere. */
function parseCategories(req: Request, value: unknown): number[] | null {
  const parsed = value === null ? null : Array.isArray(value) && value.every((id) => Number.isSafeInteger(id) && id > 0) ? [...new Set(value as number[])] : undefined
  if (parsed === undefined) throw badRequest('Categories must be a list of ids or null')
  if (!limitWithin(parsed, visibleCategories(req))) throw badRequest('You can only pick categories you can see')
  return parsed
}

const getHook = (id: number) => db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow | undefined

function requireHook(req: Request) {
  const hook = getHook(idParam(req))
  if (!hook) throw notFound('Webhook not found')
  return hook
}

integrationsRouter.get('/integrations', (_req, res) => {
  const rows = db.prepare('SELECT * FROM webhooks ORDER BY id').all() as WebhookRow[]
  res.json({ webhooks: rows.map(serialize), eventGroups: EVENT_GROUPS })
})

integrationsRouter.post('/integrations', (req, res) => {
  const actor = me(req)
  const name = text(req.body?.name, 'Name', { min: 1, max: 40 })
  const url = parseUrl(req.body?.url)
  // Someone who sees only some categories starts with exactly those, never with "everything".
  const visible = visibleCategories(req)
  const { lastInsertRowid } = db.prepare('INSERT INTO webhooks (name, url, categories, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, url, visible === null ? null : JSON.stringify(visible), actor.id, Date.now())
  const id = Number(lastInsertRowid)
  audit(actor.id, 'integration', id, 'integration.created', { name })
  res.status(201).json(serialize(getHook(id)!))
})

integrationsRouter.patch('/integrations/:id', (req, res) => {
  const actor = me(req)
  const hook = requireHook(req)
  const body = req.body ?? {}
  const next: Partial<WebhookRow> = {}
  if (body.name !== undefined) next.name = text(body.name, 'Name', { min: 1, max: 40 })
  if (body.url !== undefined) next.url = parseUrl(body.url)
  if (body.enabled !== undefined) next.enabled = body.enabled ? 1 : 0
  if (body.events !== undefined) {
    const events = parseEvents(body.events)
    next.events = events && JSON.stringify(events)
  }
  if (body.categories !== undefined) {
    const categories = parseCategories(req, body.categories)
    next.categories = categories && JSON.stringify(categories)
  }
  const changes = diff(hook, next)
  if (Object.keys(changes).length) {
    const merged = { ...hook, ...next }
    // A new URL or turning it back on starts fresh, so an old error does not linger.
    const clearError = Boolean(changes.url || (changes.enabled && merged.enabled))
    db.prepare('UPDATE webhooks SET name = ?, url = ?, enabled = ?, events = ?, categories = ?, last_error = ? WHERE id = ?')
      .run(merged.name, merged.url, merged.enabled, merged.events, merged.categories, clearError ? null : merged.last_error, hook.id)
    if (changes.enabled && !merged.enabled) db.prepare('DELETE FROM webhook_queue WHERE webhook_id = ?').run(hook.id)
    // The URL is a secret, so the log only says that it changed.
    if (changes.url) changes.url = ['…', '…']
    audit(actor.id, 'integration', hook.id, 'integration.updated', { name: merged.name, changes })
  }
  res.json(serialize(getHook(hook.id)!))
})

integrationsRouter.delete('/integrations/:id', (req, res) => {
  const actor = me(req)
  const hook = requireHook(req)
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(hook.id)
  audit(actor.id, 'integration', hook.id, 'integration.deleted', { name: hook.name })
  res.status(204).end()
})

/** Sends a sample message right away, so a wrong URL shows up immediately. */
integrationsRouter.post('/integrations/:id/test', async (req, res) => {
  const actor = me(req)
  const hook = requireHook(req)
  const who = actor.displayName || actor.username || 'Someone'
  const result = await sendToDiscord(hook.url, [
    { color: 0x16a34a, description: `**${who.replace(/[\\*_~`|>[\]()#@-]/g, '\\$&')} sent a test message**\n-# The webhook “${hook.name.replace(/[\\*_~`|>[\]()#@-]/g, '\\$&')}” is connected to Taskhub` },
  ])
  db.prepare('UPDATE webhooks SET last_error = ?, last_sent_at = COALESCE(?, last_sent_at) WHERE id = ?')
    .run(result.ok ? null : result.error, result.ok ? Date.now() : null, hook.id)
  if (!result.ok) throw badRequest(result.error)
  res.json({ ok: true })
})
