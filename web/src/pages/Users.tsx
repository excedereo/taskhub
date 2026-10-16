import { useState, type FormEvent } from 'react'
import { UserPlus } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe } from '../store.tsx'
import type { User } from '../types.ts'
import { covers, cx, displayName, formatDate, timeAgo } from '../util.ts'
import { Avatar, ConfirmButton, Field, Modal, PageHeader, RoleBadge } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'

const STATUS_LABEL: Record<User['status'], string> = { active: 'Active', invited: 'Invited', disabled: 'Disabled' }

export function UsersPage() {
  const me = useMe()
  const { users, roles, roleById, can, reloadUsers, reloadRoles } = useData()
  const toast = useToast()
  const [adding, setAdding] = useState(false)

  const canManage = can('manage_users')
  const grantable = roles.filter((r) => covers(me.permissions, r.permissions))
  const manageable = (u: User) => canManage && u.id !== me.id && covers(me.permissions, roleById.get(u.roleId)?.permissions ?? [])

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
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <UserPlus size={14} /> Add user
            </button>
          )
        }
      />

      <div className="table">
        <div className="table-head users-grid">
          <span>User</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last seen</span>
          <span />
        </div>
        {users.map((u) => (
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
                <select className="input input-sm" value={u.roleId} onChange={(e) => run(() => api.patch(`/users/${u.id}`, { roleId: Number(e.target.value) }))} aria-label="Role">
                  {grantable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <RoleBadge role={roleById.get(u.roleId)} />
              )}
            </span>
            <span>
              <span className={cx('pill', `pill-${u.status}`)}>{STATUS_LABEL[u.status]}</span>
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
          <select className="input" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
            {grantable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  )
}
