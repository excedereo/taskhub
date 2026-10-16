import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ScrollText, Users as UsersIcon } from 'lucide-react'
import { Select } from '../components/Select.tsx'
import { api } from '../api.ts'
import { useData, useSession } from '../store.tsx'
import type { AuditEvent } from '../types.ts'
import { cx, displayName, formatDate, timeAgo } from '../util.ts'
import { Avatar, Empty, PageHeader } from '../components/ui.tsx'
import { describeEvent } from '../components/describeEvent.tsx'
import { useToast } from '../components/Toast.tsx'

const TYPES = [
  { key: '', label: 'Everything' },
  { key: 'task', label: 'Tasks' },
  { key: 'category', label: 'Categories' },
  { key: 'user', label: 'Users' },
  { key: 'role', label: 'Roles' },
  { key: 'settings', label: 'Settings' },
  { key: 'integration', label: 'Integrations' },
]

type Page = { items: AuditEvent[]; nextCursor: number | null }

export function AuditPage() {
  const { meta } = useSession()
  const { userById, roleById, categoryById, users, can } = useData()
  const toast = useToast()
  const [entityType, setEntityType] = useState('')
  const [actorId, setActorId] = useState('')
  const [items, setItems] = useState<AuditEvent[] | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)

  const fetchPage = useCallback(
    (before: number | null) => {
      const qs = new URLSearchParams({ limit: '50' })
      if (entityType) qs.set('entityType', entityType)
      if (actorId) qs.set('actorId', actorId)
      if (before) qs.set('before', String(before))
      return api.get<Page>(`/audit?${qs}`)
    },
    [entityType, actorId],
  )

  useEffect(() => {
    setItems(null)
    fetchPage(null)
      .then((p) => {
        setItems(p.items)
        setCursor(p.nextCursor)
      })
      .catch(toast.error)
  }, [fetchPage, toast])

  const loadMore = async () => {
    try {
      const p = await fetchPage(cursor)
      setItems((list) => [...(list ?? []), ...p.items])
      setCursor(p.nextCursor)
    } catch (err) {
      toast.error(err)
    }
  }

  if (!can('view_audit')) return <div className="page"><Empty title="You do not have access to the audit log" /></div>

  const ctx = { userById, roleById, categoryById, permissions: meta?.permissions ?? [] }

  return (
    <div className="page">
      <PageHeader title="Audit log" description="Every change made on this instance, newest first." />

      <div className="toolbar">
        <div className="segmented">
          {TYPES.map((t) => (
            <button key={t.key} className={cx(entityType === t.key && 'active')} onClick={() => setEntityType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <Select
            variant="sm"
            aria-label="Filter by person"
            value={actorId}
            onChange={setActorId}
            options={[
              { value: '', label: 'Anyone', icon: <UsersIcon size={14} className="muted" /> },
              ...users.map((u) => ({ value: String(u.id), label: displayName(u), icon: <Avatar user={u} size={18} /> })),
            ]}
          />
        </div>
      </div>

      {items === null ? (
        <div className="skeleton-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty icon={<ScrollText size={20} />} title="Nothing here yet" />
      ) : (
        <ol className="audit-list">
          {items.map((e) => {
            const actor = e.actorId ? userById.get(e.actorId) : null
            return (
              <li key={e.id} className="audit-row">
                <Avatar user={actor} size={28} />
                <span className="audit-text">
                  <strong>{displayName(actor)}</strong> {describeEvent(e, ctx)}
                  {e.entityType === 'task' && e.action !== 'task.deleted' && (
                    <Link className="audit-link" to={`/tasks?status=all&task=${e.entityId}`}>
                      Open
                    </Link>
                  )}
                </span>
                <span className="muted small audit-time" title={formatDate(e.createdAt)}>
                  {timeAgo(e.createdAt)}
                </span>
              </li>
            )
          })}
        </ol>
      )}

      {cursor && (
        <div className="center">
          <button className="btn btn-ghost" onClick={loadMore}>
            Load older
          </button>
        </div>
      )}
    </div>
  )
}
