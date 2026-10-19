import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { api } from '../api.ts'
import { useMe } from '../store.tsx'
import type { ApiToken } from '../types.ts'
import { cx, formatDate, timeAgo } from '../util.ts'
import { ConfirmButton } from './ui.tsx'
import { Select } from './Select.tsx'
import { useToast } from './Toast.tsx'

const EXPIRY: { value: number | null; label: string }[] = [
  { value: null, label: 'Never expires' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
]

/** Ready-to-paste ways to use a token. */
function snippets(token: string) {
  const origin = window.location.origin
  return [
    { label: 'Claude Code', text: `claude mcp add --transport http taskhub ${origin}/api/mcp --header "Authorization: Bearer ${token}"` },
    {
      label: 'Other MCP clients (JSON config)',
      text: JSON.stringify({ mcpServers: { taskhub: { type: 'http', url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    },
    { label: 'REST API', text: `curl ${origin}/api/tasks?assignee=me -H "Authorization: Bearer ${token}"` },
  ]
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  return (
    <div className="stack gap-xs">
      <span className="muted small">{label}</span>
      <div className="token-code">
        <pre>{text}</pre>
        <button type="button" className="icon-btn" onClick={copy} aria-label={`Copy ${label}`} title="Copy">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  )
}

/** Personal API tokens: scripts and AI agents act as you, with exactly your role's permissions. */
export function ApiTokens() {
  const toast = useToast()
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [name, setName] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [marked, setMarked] = useState(true)
  const isAdmin = useMe().permissions.includes('admin')
  const [expires, setExpires] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)

  const reload = () => api.get<ApiToken[]>('/me/tokens').then(setTokens)
  useEffect(() => {
    reload().catch(toast.error)
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const created = await api.post<ApiToken & { token: string }>('/me/tokens', { name: name.trim(), readOnly, expiresInDays: expires, marked })
      setFresh(created.token)
      setName('')
      await reload()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const setMark = async (t: ApiToken, value: boolean) => {
    try {
      await api.patch(`/me/tokens/${t.id}`, { marked: value })
      await reload()
    } catch (err) {
      toast.error(err)
    }
  }

  const revoke = async (t: ApiToken) => {
    try {
      await api.del(`/me/tokens/${t.id}`)
      await reload()
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <section className="section" data-tour="api-tokens">
      <h2 className="section-title">API tokens and AI agents</h2>
      <div className="card form">
        <p className="muted small">
          A token lets a script or an AI agent (Claude Code, Cursor and others) work in Taskhub as you: it can do exactly what your role allows, and
          everything it does is marked “via” the token’s name in the history. Keep tokens secret, like a password.
        </p>

        {fresh ? (
          <div className="token-secret">
            <span>
              <strong>Copy your token now.</strong> It will not be shown again.
            </span>
            {[{ label: 'Token', text: fresh }, ...snippets(fresh)].map((s) => (
              <CopyBlock key={s.label} label={s.label} text={s.text} />
            ))}
            <button type="button" className="btn btn-sm token-done" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        ) : (
          <form className="token-new" onSubmit={create}>
            <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Claude Code on laptop" aria-label="Token name" />
            <div className="segmented segmented-sm">
              <button type="button" className={cx(!readOnly && 'active')} onClick={() => setReadOnly(false)}>
                Full access
              </button>
              <button type="button" className={cx(readOnly && 'active')} onClick={() => setReadOnly(true)}>
                Read only
              </button>
            </div>
            <Select variant="sm" aria-label="Expires" value={expires} onChange={setExpires} options={EXPIRY} />
            {isAdmin && (
              <label className="token-mark" title="Show “via <token name>” next to changes made with this token">
                <input type="checkbox" checked={marked} onChange={(e) => setMarked(e.target.checked)} /> Mark changes
              </label>
            )}
            <button className="btn btn-primary" disabled={busy || !name.trim()}>
              <KeyRound size={14} /> Create token
            </button>
          </form>
        )}

        {tokens && tokens.length > 0 && (
          <ul className="token-list">
            {tokens.map((t) => {
              const expired = t.expiresAt !== null && t.expiresAt < Date.now()
              return (
                <li key={t.id} className={cx(expired && 'dimmed')}>
                  <span className="stack min-w-0 grow">
                    <span className="truncate">
                      {t.name} {t.readOnly && <span className="badge badge-sm">Read only</span>} {!t.marked && <span className="badge badge-sm" title="Changes made with this token are not marked in the history">Unmarked</span>} {expired && <span className="badge badge-sm">Expired</span>}
                    </span>
                    <span className="muted small truncate">
                      <span className="mono">th_…{t.hint}</span> · created {timeAgo(t.createdAt)} · {t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : 'never used'}
                      {t.expiresAt && !expired && <span title={formatDate(t.expiresAt)}> · expires {new Date(t.expiresAt).toLocaleDateString('en', { dateStyle: 'medium' })}</span>}
                    </span>
                  </span>
                  {isAdmin && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMark(t, !t.marked)} title={t.marked ? 'Stop showing “via” for this token' : 'Show “via” for this token again'}>
                      {t.marked ? 'Hide via' : 'Show via'}
                    </button>
                  )}
                  <ConfirmButton className="btn-sm" confirmText="Revoke?" onConfirm={() => revoke(t)}>
                    Revoke
                  </ConfirmButton>
                </li>
              )
            })}
          </ul>
        )}

        <details className="token-help">
          <summary>How to connect an agent</summary>
          <p className="muted small">
            Taskhub speaks MCP, the standard way AI agents discover tools. Once connected, an agent can look up categories and people, find, create and update
            tasks, take or assign them, and archive them. A read-only token only gets the tools that look things up. Replace <code>YOUR_TOKEN</code> with a token
            from above.
          </p>
          {snippets('YOUR_TOKEN').map((s) => (
            <CopyBlock key={s.label} label={s.label} text={s.text} />
          ))}
        </details>
      </div>
    </section>
  )
}
