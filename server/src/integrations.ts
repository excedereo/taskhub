import { config } from './config.ts'
import { db, getSetting } from './db.ts'
import { onAudit, type AuditEntry } from './audit.ts'
import { logoUrl } from './routes/logo.ts'

/** What a webhook can subscribe to. One audit entry may produce several kinds (a status change into Done is also "finished"). */
export const EVENT_GROUPS = [
  {
    label: 'Tasks',
    kinds: [
      { key: 'task.created', label: 'Created' },
      { key: 'task.assignee', label: 'Taken and assigned' },
      { key: 'task.status', label: 'Status changed' },
      { key: 'task.finished', label: 'Finished' },
      { key: 'task.priority', label: 'Priority changed' },
      { key: 'task.details', label: 'Title, description, due date, labels' },
      { key: 'task.moved', label: 'Moved to another category' },
      { key: 'task.images', label: 'Images' },
      { key: 'task.archive', label: 'Archived and restored' },
      { key: 'task.deleted', label: 'Deleted' },
    ],
  },
  {
    label: 'Workspace',
    kinds: [
      { key: 'category', label: 'Categories' },
      { key: 'workflow', label: 'Statuses, priorities, labels' },
      { key: 'user', label: 'Users' },
      { key: 'role', label: 'Roles' },
      { key: 'settings', label: 'Settings and integrations' },
    ],
  },
] as const

export const EVENT_KINDS: string[] = EVENT_GROUPS.flatMap((g) => g.kinds.map((k) => k.key))

type Changes = Record<string, [unknown, unknown]>

const statusRow = (id: unknown) =>
  typeof id === 'number' ? (db.prepare('SELECT name, color, type FROM statuses WHERE id = ?').get(id) as { name: string; color: string; type: string } | undefined) : undefined

/** Event kinds an audit entry belongs to; an empty list means it is never posted (reorders, duplicates). */
export function kindsOf(e: AuditEntry): string[] {
  const changes = (e.data.changes ?? {}) as Changes
  switch (e.action) {
    case 'task.created':
      return ['task.created']
    case 'task.taken':
    case 'task.assigned':
    case 'task.unassigned':
      return ['task.assignee']
    case 'task.updated': {
      const kinds: string[] = []
      if (changes.status_id) kinds.push('task.status')
      if (changes.status_id && statusRow(changes.status_id[1])?.type === 'done') kinds.push('task.finished')
      if (changes.priority_id) kinds.push('task.priority')
      if (changes.title || changes.description || changes.due_date || changes.labels) kinds.push('task.details')
      if (changes.category_id) kinds.push('task.moved')
      if (changes.assignee_id) kinds.push('task.assignee')
      return kinds
    }
    case 'task.attachment_added':
    case 'task.attachment_removed':
      return ['task.images']
    case 'task.archived':
    case 'task.unarchived':
    case 'category.archived_done':
      return ['task.archive']
    case 'task.deleted':
      return ['task.deleted']
  }
  if (e.action.endsWith('.reordered')) return []
  switch (e.entityType) {
    case 'category':
      return ['category']
    case 'label':
    case 'status':
    case 'priority':
      return ['workflow']
    case 'user':
      return ['user']
    case 'role':
      return ['role']
    case 'settings':
    case 'integration':
    case 'theme':
      return ['settings']
  }
  return []
}

type TaskInfo = { id: number; title: string; category_id: number; parent_id: number | null; status_name: string | null; status_color: string | null; priority_name: string | null; category_name: string | null }

const taskInfo = (id: number | null) =>
  id === null
    ? undefined
    : (db.prepare(`
        SELECT t.id, t.title, t.category_id, t.parent_id, s.name AS status_name, s.color AS status_color, p.name AS priority_name, c.name AS category_name
        FROM tasks t
        LEFT JOIN statuses s ON s.id = t.status_id
        LEFT JOIN priorities p ON p.id = t.priority_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.id = ?
      `).get(id) as TaskInfo | undefined)

/** The category an event is about, for the category filter; null when it is not about one. */
function categoryOf(e: AuditEntry, task: TaskInfo | undefined): number | null {
  if (e.entityType === 'task') return task?.category_id ?? (typeof e.data.categoryId === 'number' ? e.data.categoryId : null)
  if (e.entityType === 'category') return e.entityId
  return null
}

const userName = (id: unknown) => {
  if (typeof id !== 'number') return 'nobody'
  const row = db.prepare('SELECT display_name, username, discord_id FROM users WHERE id = ?').get(id) as { display_name: string | null; username: string | null; discord_id: string } | undefined
  return row ? row.display_name || row.username || row.discord_id : 'a removed user'
}
const nameOf = (table: 'statuses' | 'priorities' | 'categories', id: unknown) =>
  typeof id === 'number' ? ((db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined)?.name ?? 'deleted') : 'none'

/** Keeps user text from turning into Discord formatting, links or mentions. */
const esc = (s: unknown) => String(s ?? '').replace(/[\\*_~`|>[\]()#-]/g, '\\$&').replace(/@/g, '@\u200b').slice(0, 200)
/**
 * Text inside a masked link: Discord ignores backslash escapes there, still applies formatting,
 * and drops the whole link when it contains "@" or brackets. Swap those for look-alikes instead.
 */
const LOOKALIKE: Record<string, string> = { '[': '［', ']': '］', '@': '＠', '*': '∗', _: 'ˍ', '~': '∼', '`': 'ˋ', '|': 'ǀ', '\\': '∖', '<': '＜', '>': '＞' }
const linkText = (s: unknown) => String(s ?? '').replace(/[[\]@*_~`|\\<>]/g, (c) => LOOKALIKE[c]).slice(0, 200)
/** Something that looks like a URL cannot be the text of a link, so such titles are shown unlinked. */
const looksLikeUrl = (s: string) => /https?:|www\.|\w\.(?:com|net|org|io|ru|gg|dev|app)\b/i.test(s)
const hex =(color: string | null | undefined) => (color && /^#[0-9a-f]{6}$/i.test(color) ? parseInt(color.slice(1), 16) : 0xa1a1aa)

export type Embed = { color: number; description: string }

/** Two short lines: who did what to which task, then the task's status, priority and category in small print. */
export function buildEmbed(e: AuditEntry): Embed | null {
  const d = e.data
  const changes = (d.changes ?? {}) as Changes
  const actor = `**${esc(userName(e.actorId))}${d.via ? ` (via ${esc(d.via)})` : ''}`
  const name = `**${esc(d.name)}**`

  if (e.entityType === 'task') {
    const task = taskInfo(e.entityId)
    const rawTitle = String(task?.title ?? d.title ?? '')
    const url = task && `${config.publicUrl}/tasks/c/${task.category_id}?task=${task.id}`
    const linked = Boolean(url && !looksLikeUrl(rawTitle))
    const link = linked ? `[${linkText(rawTitle)}](${url})` : `**${esc(rawTitle)}**`
    const sub = task?.parent_id ? ' subtask' : ''
    let verb: string
    switch (e.action) {
      case 'task.created':
        verb = `created${sub}**`
        break
      case 'task.taken':
        verb = 'took**'
        break
      case 'task.assigned':
        verb = `assigned ${esc(userName(changes.assignee_id?.[1]))} to**`
        break
      case 'task.unassigned':
        verb = `unassigned ${esc(userName(changes.assignee_id?.[0]))} from**`
        break
      case 'task.archived':
        verb = 'archived**'
        break
      case 'task.unarchived':
        verb = 'restored**'
        break
      case 'task.deleted':
        verb = 'deleted**'
        break
      case 'task.attachment_added':
        verb = 'attached an image to**'
        break
      case 'task.attachment_removed':
        verb = 'removed an image from**'
        break
      default: {
        const to = statusRow(changes.status_id?.[1])
        if (changes.status_id) verb = to?.type === 'done' ? 'finished**' : `moved to ${esc(to?.name)}**`
        else if (changes.category_id) verb = `moved to ${esc(nameOf('categories', changes.category_id[1]))}**`
        else if (changes.priority_id) verb = `set ${esc(nameOf('priorities', changes.priority_id[1]))} priority on**`
        else if (changes.assignee_id) verb = `assigned ${esc(userName(changes.assignee_id[1]))} to**`
        else verb = 'edited**'
      }
    }
    if (e.action === 'task.updated' && !Object.keys(changes).length) return null

    const meta: string[] = []
    if (task) {
      const status = changes.status_id ? `${nameOf('statuses', changes.status_id[0])} → ${task.status_name}` : task.status_name
      const priority = changes.priority_id ? `${nameOf('priorities', changes.priority_id[0])} → ${task.priority_name}` : task.priority_name
      meta.push(esc(status), esc(priority), esc(task.category_name))
      const edited = (['title', 'description', 'due_date', 'labels'] as const).filter((k) => changes[k]).map((k) => (k === 'due_date' ? 'due date' : k))
      if (edited.length && verb !== 'edited**') meta.push(`edited ${edited.join(', ')}`)
      else if (edited.length) meta.push(edited.join(', '))
    } else {
      meta.push(esc(nameOf('categories', d.categoryId)))
    }
    meta.push(url && !linked ? `[#${e.entityId}](${url})` : `#${e.entityId}`)
    return {
      color: e.action === 'task.deleted' ? 0xdc2626 : hex(task?.status_color),
      description: `${actor} ${verb} ${link}\n-# ${meta.filter(Boolean).join(' · ')}`,
    }
  }

  const simple: Record<string, string> = {
    'category.created': `created the category ${name}`,
    'category.deleted': `deleted the category ${name}${Number(d.tasks) > 0 ? ` with ${Number(d.tasks)} task(s)` : ''}`,
    'category.updated': changes.archived ? (changes.archived[1] ? `archived the category ${name}` : `restored the category ${name}`) : `edited the category ${name}`,
    'category.arranged': `rearranged sections in ${name}`,
    'category.archived_done': `archived ${Number(d.count)} finished task(s) in ${name}`,
    'label.created': `created the label ${name}`,
    'label.updated': `edited the label ${name}`,
    'label.deleted': `deleted the label ${name}`,
    'status.created': `added the status ${name}`,
    'status.updated': `edited the status ${name}`,
    'status.deleted': `deleted the status ${name}`,
    'priority.created': `added the priority ${name}`,
    'priority.updated': `edited the priority ${name}`,
    'priority.deleted': `deleted the priority ${name}`,
    'role.created': `created the role ${name}`,
    'role.updated': `edited the role ${name}`,
    'role.deleted': `deleted the role ${name}`,
    'user.invited': `added ${name} to the team`,
    'user.updated': `changed ${name}`,
    'user.removed': `removed ${name}`,
    'user.token_created': `created an API token`,
    'user.token_revoked': `revoked an API token`,
    'user.token_unmarked': 'stopped marking the changes of one of their API tokens',
    'user.token_marked': 'marked the changes of one of their API tokens again',
    'user.joined': 'joined the team',
    'user.activated': 'signed in for the first time',
    'user.bootstrap': 'set up this instance',
    'settings.updated': 'changed workspace settings',
    'integration.created': `connected the webhook ${name}`,
    'integration.updated': `changed the webhook ${name}`,
    'integration.deleted': `removed the webhook ${name}`,
    'theme.created': `added the theme ${name}`,
    'theme.updated': `edited the theme ${name}`,
    'theme.deleted': `deleted the theme ${name}`,
  }
  // Something without a sentence yet still reads as words, never as an internal code.
  const text = simple[e.action] ?? `made a change (${esc(e.action.split('.').pop()!.replace(/_/g, ' '))})`
  return { color: 0xa1a1aa, description: `${actor}** ${text}` }
}

type WebhookRow = {
  id: number
  name: string
  url: string
  events: string | null
  categories: string | null
  enabled: number
  last_error: string | null
  last_sent_at: number | null
  created_at: number
}

const MAX_QUEUE = 500

onAudit((e) => {
  const kinds = kindsOf(e)
  if (!kinds.length) return
  const hooks = db.prepare('SELECT * FROM webhooks WHERE enabled = 1').all() as WebhookRow[]
  if (!hooks.length) return
  const task = e.entityType === 'task' ? taskInfo(e.entityId) : undefined
  const category = categoryOf(e, task)
  let embed: string | null | undefined
  for (const hook of hooks) {
    const events = hook.events ? (JSON.parse(hook.events) as string[]) : null
    const categories = hook.categories ? (JSON.parse(hook.categories) as number[]) : null
    if (events && !kinds.some((k) => events.includes(k))) continue
    if (categories && category !== null && !categories.includes(category)) continue
    if (embed === undefined) {
      const built = buildEmbed(e)
      embed = built && JSON.stringify(built)
    }
    if (!embed) return
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM webhook_queue WHERE webhook_id = ?').get(hook.id) as { n: number }
    if (n >= MAX_QUEUE) continue
    db.prepare('INSERT INTO webhook_queue (webhook_id, embed, created_at) VALUES (?, ?, ?)').run(hook.id, embed, Date.now())
  }
})

/** Discord rejects webhook names containing "discord", and caps them at 80 characters. */
function senderName() {
  const name = (getSetting<string>('instance_name') || 'Taskhub').slice(0, 80)
  return /discord|clyde/i.test(name) ? 'Taskhub' : name
}

function payload(embeds: Embed[]) {
  const logo = logoUrl()
  return {
    username: senderName(),
    // Discord fetches the avatar itself, so it only works when the instance is reachable from the internet.
    ...(config.secureCookies ? { avatar_url: config.publicUrl + (logo ?? '/logo.png') } : {}),
    embeds,
    allowed_mentions: { parse: [] },
  }
}

type SendResult = { ok: true } | { ok: false; status: number; error: string; retryAfter?: number }

/** One POST to Discord, reporting rate limits so the caller can wait. */
export async function sendToDiscord(url: string, embeds: Embed[]): Promise<SendResult & { waitMs?: number }> {
  let res: Response
  try {
    res = await fetch(`${url}?wait=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(embeds)),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    return { ok: false, status: 0, error: `Could not reach Discord: ${(err as Error).message}` }
  }
  // When the bucket is empty, wait for it to refill before the next message.
  const remaining = res.headers.get('x-ratelimit-remaining')
  const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'))
  const waitMs = remaining === '0' && resetAfter > 0 ? Math.ceil(resetAfter * 1000) : undefined
  if (res.ok) return { ok: true, waitMs }
  let message = `Discord answered ${res.status}`
  let retryAfter: number | undefined
  try {
    const body = (await res.json()) as { message?: string; retry_after?: number }
    if (body.message) message += `: ${body.message}`
    if (typeof body.retry_after === 'number') retryAfter = Math.ceil(body.retry_after * 1000)
  } catch {}
  return { ok: false, status: res.status, error: message, retryAfter, waitMs }
}

// Messages per webhook are spaced out; the timer only decides who is due.
const BATCH = 10
const SPACING_MS = 2500
// A burst of clicks becomes one message: wait until things go quiet, but never hold events too long.
const QUIET_MS = 4000
const MAX_WAIT_MS = 15_000
const MAX_ATTEMPTS = 5
const nextAt = new Map<number, number>()
let busy = false

async function tick() {
  if (busy) return
  busy = true
  try {
    const hooks = db.prepare('SELECT DISTINCT w.* FROM webhooks w JOIN webhook_queue q ON q.webhook_id = w.id WHERE w.enabled = 1').all() as WebhookRow[]
    for (const hook of hooks) {
      if ((nextAt.get(hook.id) ?? 0) > Date.now()) continue
      const window = db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM webhook_queue WHERE webhook_id = ?').get(hook.id) as { n: number; oldest: number; newest: number }
      const now = Date.now()
      if (window.n < BATCH && now - window.newest < QUIET_MS && now - window.oldest < MAX_WAIT_MS) continue
      const rows = db.prepare('SELECT id, embed, attempts FROM webhook_queue WHERE webhook_id = ? ORDER BY id LIMIT ?').all(hook.id, BATCH) as { id: number; embed: string; attempts: number }[]
      if (!rows.length) continue
      const ids = rows.map((r) => r.id)
      const drop = () => db.prepare(`DELETE FROM webhook_queue WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
      const result = await sendToDiscord(hook.url, rows.map((r) => JSON.parse(r.embed) as Embed))
      nextAt.set(hook.id, Date.now() + Math.max(SPACING_MS, result.waitMs ?? 0))

      if (result.ok) {
        drop()
        db.prepare('UPDATE webhooks SET last_sent_at = ?, last_error = NULL WHERE id = ?').run(Date.now(), hook.id)
      } else if (result.status === 429) {
        nextAt.set(hook.id, Date.now() + (result.retryAfter ?? 5000))
      } else if (result.status === 401 || result.status === 403 || result.status === 404) {
        // The webhook was deleted or its token changed: stop instead of knocking forever.
        db.prepare('DELETE FROM webhook_queue WHERE webhook_id = ?').run(hook.id)
        db.prepare('UPDATE webhooks SET enabled = 0, last_error = ? WHERE id = ?').run(`${result.error}. The webhook was turned off; check its URL.`, hook.id)
      } else if (result.status >= 400 && result.status < 500) {
        drop()
        db.prepare('UPDATE webhooks SET last_error = ? WHERE id = ?').run(result.error, hook.id)
      } else {
        // Network trouble or a Discord outage: try again a bit later, give up after a few attempts.
        db.prepare(`UPDATE webhook_queue SET attempts = attempts + 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
        db.prepare('DELETE FROM webhook_queue WHERE webhook_id = ? AND attempts >= ?').run(hook.id, MAX_ATTEMPTS)
        db.prepare('UPDATE webhooks SET last_error = ? WHERE id = ?').run(result.error, hook.id)
        nextAt.set(hook.id, Date.now() + 30_000)
      }
    }
  } catch (err) {
    console.error('Webhook delivery failed:', err)
  } finally {
    busy = false
  }
}

export function startWebhookWorker() {
  setInterval(tick, 1000).unref()
}

export type { WebhookRow }
