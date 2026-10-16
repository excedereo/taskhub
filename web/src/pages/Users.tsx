import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, UserPlus } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import type { User } from '../types.ts'
import { covers, cx, displayName, formatDate, timeAgo } from '../util.ts'
import { Avatar, ConfirmButton, Field, Modal, PageHeader, RoleBadge, roleOptions } from '../components/ui.tsx'
import { Select } from '../components/Select.tsx'
import { useToast } from '../components/Toast.tsx'

const STATUS_LABEL: Record<User['status'], string> = { active: 'Active', invited: 'Invited', disabled: 'Disabled' }
const STATUS_ORDER: Record<User['status'], number> = { active: 0, invited: 1, disabled: 2 }

type SortKey = 'name' | 'role' | 'status' | 'joined' | 'seen'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }
const SORT_KEY = 'taskhub.users-sort'
const DEFAULT_SORT: Sort = { key: 'role', dir: 'asc' }
const SORT_KEYS: SortKey[] = ['name', 'role', 'status', 'joined', 'seen']

function readSort(): Sort {
  try {
    const raw = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null') as Sort | null
    if (raw && SORT_KEYS.includes(raw.key) && (raw.dir === 'asc' || raw.dir === 'desc')) return raw
  } catch {
    // unreadable: fall back to the default
  }
  return DEFAULT_SORT
}

const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

export function UsersPage() {
  const me = useMe()
  const { users, roles, roleById, can, reloadUsers, reloadRoles } = useData()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [sort, setSort] = useState<Sort>(readSort)

  const canManage = can('manage_users')
  if (!canManage) return <Navigate to="/tasks" replace />
  const grantable = roles.filter((r) => covers(me.permissions, r.permissions))
  const manageable = (u: User) => canManage && u.id !== me.id && covers(me.permissions, roleById.get(u.roleId)?.permissions ?? [])

  const changeSort = (key: SortKey) => {
    // A new column starts ascending, except dates, which start with the newest.
    const next: Sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'joined' || key === 'seen' ? 'desc' : 'asc' }
    setSort(next)
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: the order just won't be remembered
    }
  }

  const rank = new Map(roles.map((r, i) => [r.id, i]))
  const byName = (a: User, b: User) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' })
  // Missing dates always go last, whichever way the column is sorted.
  const byDate = (a: number | null, b: number | null, dir: number) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * dir)
  const sorted = [...users].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    // Disabled people sink to the bottom unless sorting by status itself.
    if (sort.key !== 'status' && (a.status === 'disabled') !== (b.status === 'disabled')) return a.status === 'disabled' ? 1 : -1
    let d = 0
    if (sort.key === 'name') d = byName(a, b) * dir
    else if (sort.key === 'role') d = ((rank.get(a.roleId) ?? 99) - (rank.get(b.roleId) ?? 99)) * dir
    else if (sort.key === 'status') d = (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir
    else if (sort.key === 'joined') d = byDate(a.joinedAt, b.joinedAt, dir)
    else d = byDate(a.lastLoginAt, b.lastLoginAt, dir)
    return d || byName(a, b)
  })

  const head = (key: SortKey, label: string): ReactNode => (
    <button type="button" className={cx('sort-head', sort.key === key && 'active')} onClick={() => changeSort(key)} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {label}
      {sort.key === key && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
    </button>
  )

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      await Promise.all([reloadUsers(), reloadRoles()])
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Users"
        description={`${users.filter((u) => u.status !== 'disabled').length} people on the team`}
        actions={
          canManage && (
            <button className="btn btn-primary" data-tour="add-user" onClick={() => setAdding(true)}>
              <UserPlus size={14} /> Add user
            </button>
          )
        }
      />

      <div className="table" data-tour="users-table">
        <div className="table-head users-grid">
          {head('name', 'User')}
          {head('role', 'Role')}
          {head('status', 'Status')}
          {head('joined', 'Joined')}
          {head('seen', 'Last seen')}
          <span />
        </div>
        {sorted.map((u) => (
          <div key={u.id} className={cx('table-row users-grid', u.status === 'disabled' && 'dimmed')}>
            <span className="row gap-sm min-w-0">
              <Avatar user={u} size={32} />
              <span className="stack min-w-0">
                <span className="truncate">
                  {u.status === 'invited' && !u.displayName ? <span className="muted">Pending sign-in</span> : displayName(u)}
                  {u.id === me.id && <span className="muted"> (you)</span>}
                </span>
                <span className="muted small truncate mono">{u.username ? `@${u.username} · ` : ''}{u.discordId}</span>
              </span>
            </span>
            <span>
              {manageable(u) ? (
                <Select variant="sm" aria-label="Role" value={u.roleId} onChange={(roleId) => run(() => api.patch(`/users/${u.id}`, { roleId }))} options={roleOptions(grantable)} />
              ) : (
                <RoleBadge role={roleById.get(u.roleId)} />
              )}
            </span>
            <span>
              <span className={cx('pill', `pill-${u.status}`)}>{STATUS_LABEL[u.status]}</span>
            </span>
            <span className="muted small" title={u.joinedAt ? formatDate(u.joinedAt) : 'Has not signed in yet'}>
              {u.joinedAt ? dateFmt.format(u.joinedAt) : 'Not yet'}
            </span>
            <span className="muted small" title={u.lastLoginAt ? formatDate(u.lastLoginAt) : undefined}>
              {u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}
            </span>
            <span className="row-actions">
              {manageable(u) &&
                (u.status === 'invited' ? (
                  <ConfirmButton className="btn-sm" confirmText="Remove?" onConfirm={() => run(() => api.del(`/users/${u.id}`))}>
                    Remove
                  </ConfirmButton>
                ) : u.status === 'disabled' ? (
                  <button className="btn btn-sm btn-ghost" onClick={() => run(() => api.patch(`/users/${u.id}`, { status: 'active' }))}>
                    Enable
                  </button>
                ) : (
                  <ConfirmButton className="btn-sm" confirmText="Disable?" onConfirm={() => run(() => api.patch(`/users/${u.id}`, { status: 'disabled' }))}>
                    Disable
                  </ConfirmButton>
                ))}
            </span>
          </div>
        ))}
      </div>

      {adding && <AddUserModal onClose={() => setAdding(false)} onAdded={() => run(async () => {})} />}
    </div>
  )
}

function AddUserModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const me = useMe()
  const { roles } = useData()
  const toast = useToast()
  const grantable = roles.filter((r) => covers(me.permissions, r.permissions))
  const [discordId, setDiscordId] = useState('')
  const [roleId, setRoleId] = useState(() => (roles.find((r) => r.isDefault) ?? grantable[0])?.id ?? 0)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/users', { discordId: discordId.trim(), roleId })
      onAdded()
      toast.info('User added. They can sign in with Discord now.')
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add user"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="add-user" className="btn btn-primary" disabled={busy || !/^\d{15,20}$/.test(discordId.trim())}>
            Add user
          </button>
        </>
      }
    >
      <form id="add-user" className="form" onSubmit={submit}>
        <Field label="Discord user ID" hint={<>In Discord, turn on Settings → Advanced → Developer Mode, then right-click the person and choose <b>Copy User ID</b>.</>}>
          <input className="input mono" value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" inputMode="numeric" autoFocus />
        </Field>
        <Field label="Role">
          <Select aria-label="Role" value={roleId} onChange={setRoleId} options={roleOptions(grantable)} />
        </Field>
      </form>
    </Modal>
  )
}
