import { db } from './db.ts'
import { requestContext } from './context.ts'

export type EntityType = 'user' | 'role' | 'category' | 'task' | 'settings' | 'label' | 'priority' | 'status' | 'integration' | 'theme'

export type AuditEntry = { actorId: number | null; entityType: EntityType; entityId: number | null; action: string; data: Record<string, unknown> }

const listeners: ((entry: AuditEntry) => void)[] = []

/** Runs after every audit entry, inside the same transaction. A failing listener never breaks the action itself. */
export function onAudit(fn: (entry: AuditEntry) => void) {
  listeners.push(fn)
}

export function audit(actorId: number | null, entityType: EntityType, entityId: number | null, action: string, data: Record<string, unknown> = {}) {
  // Actions made through an API token say so, e.g. "via Claude Code".
  const via = requestContext.getStore()?.via
  if (via) data = { ...data, via }
  db.prepare('INSERT INTO audit_log (actor_id, entity_type, entity_id, action, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actorId, entityType, entityId, action, JSON.stringify(data), Date.now())
  for (const fn of listeners) {
    try {
      fn({ actorId, entityType, entityId, action, data })
    } catch (err) {
      console.error('Audit listener failed:', err)
    }
  }
}

/** Collects `{ field: [before, after] }` for fields that actually changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, [unknown, unknown]> = {}
  for (const key of Object.keys(after)) {
    if (after[key] !== undefined && after[key] !== before[key]) changes[key] = [before[key], after[key]]
  }
  return changes
}

export type AuditRow = {
  id: number
  actor_id: number | null
  entity_type: EntityType
  entity_id: number | null
  action: string
  data: string
  created_at: number
}

export function serializeAudit(row: AuditRow) {
  return {
    id: row.id,
    actorId: row.actor_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    data: JSON.parse(row.data) as Record<string, unknown>,
    createdAt: row.created_at,
  }
}
