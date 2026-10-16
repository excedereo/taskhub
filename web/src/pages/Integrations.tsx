import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Webhook as WebhookIcon } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import type { EventGroup, Webhook } from '../types.ts'
import { cx, timeAgo } from '../util.ts'
import { ConfirmButton, Empty, Field, PageHeader } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { CategoryLimit } from './Roles.tsx'

type Payload = { webhooks: Webhook[]; eventGroups: EventGroup[] }

/** Discord webhooks that post a feed of chosen events to a channel. */
export function IntegrationsPage() {
  const { can } = useData()
  const toast = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const allowed = can('manage_integrations')

  const reload = useCallback(() => api.get<Payload>('/integrations').then(setData).catch(toast.error), [toast])
  useEffect(() => {
    if (allowed) reload()
  }, [allowed, reload])

  if (!allowed) return <Navigate to="/tasks" replace />

  const replace = (hook: Webhook) => setData((d) => d && { ...d, webhooks: d.webhooks.map((w) => (w.id === hook.id ? hook : w)) })

  return (
    <div className="page page-narrow">
      <PageHeader title="Integrations" description="Post what happens in Taskhub to a Discord channel. Several events are combined into one message, so busy moments do not flood the channel." />
      {data && (
        <>
          {data.webhooks.length === 0 && (
            <div className="card">
              <Empty icon={<WebhookIcon size={20} />} title="No webhooks yet">
                Add one below to start posting events to Discord.
              </Empty>
            </div>
          )}
          {data.webhooks.map((w) => (
            <WebhookCard key={w.id} hook={w} groups={data.eventGroups} onChange={replace} onRemoved={reload} />
          ))}
          <AddWebhook onAdded={reload} />
        </>
      )}
    </div>
  )
}

function AddWebhook({ onAdded }: { onAdded: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/integrations', { name: name.trim(), url: url.trim() })
      setName('')
      setUrl('')
      onAdded()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form hook-card" onSubmit={submit}>
      <div className="stack">
        <span>Add a Discord webhook</span>
        <span className="muted small">In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.</span>
      </div>
      <div className="hook-add">
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Bug feed" />
        <input className="input grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
        <button className="btn btn-primary" disabled={busy || !name.trim() || !url.trim()}>
          Add
        </button>
      </div>
    </form>
  )
}

function WebhookCard({ hook, groups, onChange, onRemoved }: { hook: Webhook; groups: EventGroup[]; onChange: (w: Webhook) => void; onRemoved: () => void }) {
  const { categories } = useData()
  const me = useMe()
  const toast = useToast()
  const [newUrl, setNewUrl] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const myView = me.permissions.includes('admin') ? null : me.viewCategoryIds

  const patch = async (body: Partial<Pick<Webhook, 'name' | 'url' | 'enabled' | 'events' | 'categories'>>) => {
    try {
      onChange(await api.patch<Webhook>(`/integrations/${hook.id}`, body))
      return true
    } catch (err) {
      toast.error(err)
      return false
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      await api.post(`/integrations/${hook.id}/test`)
      toast.info('Test message sent, check the channel')
    } catch (err) {
      toast.error(err)
    } finally {
      setTesting(false)
      onChange(await api.get<{ webhooks: Webhook[] }>('/integrations').then((d) => d.webhooks.find((w) => w.id === hook.id) ?? hook).catch(() => hook))
    }
  }

  return (
    <section className={cx('card form hook-card', !hook.enabled && 'hook-off')}>
      <div className="hook-head">
        <input
          className="input input-inline hook-name"
          defaultValue={hook.name}
          maxLength={40}
          aria-label="Webhook name"
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== hook.name && patch({ name: e.target.value.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div className="segmented segmented-sm">
          <button type="button" className={cx(hook.enabled && 'active')} onClick={() => !hook.enabled && patch({ enabled: true })}>
            On
          </button>
          <button type="button" className={cx(!hook.enabled && 'active')} onClick={() => hook.enabled && patch({ enabled: false })}>
            Off
          </button>
        </div>
        <button type="button" className="btn btn-sm" disabled={testing} onClick={test}>
          Send test
        </button>
        <ConfirmButton className="btn-sm" confirmText="Remove?" onConfirm={async () => {
          try {
            await api.del(`/integrations/${hook.id}`)
            onRemoved()
          } catch (err) {
            toast.error(err)
          }
        }}>
          Remove
        </ConfirmButton>
      </div>

      <div className="hook-meta muted small">
        {newUrl === null ? (
          <>
            <code className="hook-url">{hook.url}</code>
            <button type="button" className="link-btn" onClick={() => setNewUrl('')}>
              Change URL
            </button>
          </>
        ) : (
          <form
            className="hook-add grow"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await patch({ url: newUrl.trim() })) setNewUrl(null)
            }}
          >
            <input className="input grow" autoFocus value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="New webhook URL" />
            <button className="btn btn-sm btn-primary" disabled={!newUrl.trim()}>
              Save
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewUrl(null)}>
              Cancel
            </button>
          </form>
        )}
      </div>
      <HookStatus hook={hook} />

      <Field label="Events">
        <EventPicker value={hook.events} groups={groups} onChange={(events) => patch({ events })} />
      </Field>
      <Field label="Categories" hint="Task and category events outside these are not posted. Users, roles and settings are not tied to a category.">
        <div className="hook-limit">
          <CategoryLimit
            value={hook.categories}
            onChange={(c) => patch({ categories: c })}
            disabled={false}
            allowed={myView}
            categories={categories}
            emptyHint="Pick at least one, otherwise no task events are posted."
          />
        </div>
      </Field>
    </section>
  )
}

function HookStatus({ hook }: { hook: Webhook }) {
  if (hook.lastError) return <div className="hook-status hook-error">{hook.lastError}</div>
  const parts = [
    !hook.enabled && 'Turned off, nothing is posted',
    hook.enabled && (hook.lastSentAt ? `Last message ${timeAgo(hook.lastSentAt)}` : 'Nothing sent yet'),
    hook.queued > 0 && `${hook.queued} waiting to be sent`,
  ].filter(Boolean)
  return <div className="hook-status muted small">{parts.join(' · ')}</div>
}

/** "Everything" or hand-picked kinds, grouped like the audit log. */
function EventPicker({ value, groups, onChange }: { value: string[] | null; groups: EventGroup[]; onChange: (v: string[] | null) => void }) {
  const toggle = (key: string) => onChange(value?.includes(key) ? value.filter((k) => k !== key) : [...(value ?? []), key])
  return (
    <div className="hook-limit">
      <div className="segmented">
        <button type="button" className={cx(value === null && 'active')} onClick={() => onChange(null)}>
          Everything
        </button>
        <button type="button" className={cx(value !== null && 'active')} onClick={() => value === null && onChange(['task.created', 'task.assignee', 'task.status'])}>
          Only selected
        </button>
      </div>
      {value !== null && (
        <div className="hook-groups">
          {groups.map((g) => (
            <div key={g.label} className="hook-group">
              <span className="muted small">{g.label}</span>
              <div className="chips">
                {g.kinds.map((k) => (
                  <label key={k.key} className={cx('chip', value.includes(k.key) && 'active')}>
                    <input type="checkbox" checked={value.includes(k.key)} onChange={() => toggle(k.key)} />
                    {k.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {value.length === 0 && <span className="muted small">Pick at least one, otherwise this webhook stays silent.</span>}
        </div>
      )}
    </div>
  )
}
