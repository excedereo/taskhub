import { useEffect, useState } from 'react'
import { Lock, Plus } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe, useSession } from '../store.tsx'
import type { Role } from '../types.ts'
import { covers, cx } from '../util.ts'
import { ConfirmButton, Field, PageHeader } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'

const COLORS = [null, '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f']

type Draft = { name: string; color: string | null; permissions: string[] }
const NEW = 'new'

export function RolesPage() {
  const me = useMe()
  const { meta } = useSession()
  const { roles, can, reloadRoles, reloadUsers } = useData()
  const toast = useToast()
  const [selected, setSelected] = useState<number | typeof NEW | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', color: null, permissions: [] })
  const [busy, setBusy] = useState(false)

  const canManage = can('manage_roles')
  const role = typeof selected === 'number' ? roles.find((r) => r.id === selected) : undefined

  useEffect(() => {
    if (selected === null && roles.length) setSelected(roles[0].id)
  }, [roles, selected])

  useEffect(() => {
    if (selected === NEW) setDraft({ name: '', color: null, permissions: [] })
    else if (role) setDraft({ name: role.name, color: role.color, permissions: role.permissions })
  }, [selected, role])

  const isOwn = role?.id === me.roleId
  // Why the editor is read-only, if it is.
  const lock = !canManage
    ? 'You can view roles but not change them.'
    : role?.isSystem
      ? 'The Owner role always has every permission and cannot be changed.'
      : role && !covers(me.permissions, role.permissions)
        ? 'This role has permissions you do not have, so you cannot edit it.'
        : null
  const readOnly = Boolean(lock)

  const dirty = selected === NEW || (role && (draft.name !== role.name || draft.color !== role.color || [...draft.permissions].sort().join() !== [...role.permissions].sort().join()))

  const toggle = (key: string) =>
    setDraft((d) => ({ ...d, permissions: d.permissions.includes(key) ? d.permissions.filter((p) => p !== key) : [...d.permissions, key] }))

  async function save() {
    setBusy(true)
    try {
      if (selected === NEW) {
        const created = await api.post<Role>('/roles', draft)
        await reloadRoles()
        setSelected(created.id)
      } else if (role) {
        const body: Partial<Draft> = { name: draft.name, color: draft.color }
        if (!isOwn) body.permissions = draft.permissions
        await api.patch(`/roles/${role.id}`, body)
        await reloadRoles()
      }
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!role) return
    try {
      await api.del(`/roles/${role.id}`)
      await Promise.all([reloadRoles(), reloadUsers()])
      setSelected(null)
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Roles"
        description="Roles decide what people can do. Everyone has exactly one role."
        actions={
          canManage && (
            <button className="btn btn-primary" onClick={() => setSelected(NEW)}>
              <Plus size={14} /> New role
            </button>
          )
        }
      />

      <div className="roles-layout">
        <ul className="role-list">
          {roles.map((r) => (
            <li key={r.id}>
              <button className={cx('role-item', selected === r.id && 'active')} onClick={() => setSelected(r.id)}>
                <span className="dot" style={{ background: r.color ?? 'var(--text-faint)' }} />
                <span className="truncate">{r.name}</span>
                {r.isSystem && <Lock size={12} className="muted" />}
                {r.isDefault && <span className="badge badge-sm">Default</span>}
                <span className="muted small role-count">{r.memberCount}</span>
              </button>
            </li>
          ))}
          {selected === NEW && (
            <li>
              <button className="role-item active">
                <span className="dot" style={{ background: draft.color ?? 'var(--text-faint)' }} />
                <span className="truncate">{draft.name || 'New role'}</span>
              </button>
            </li>
          )}
        </ul>

        {(role || selected === NEW) && (
          <div className="card role-editor">
            {lock && <div className="notice">{lock}</div>}

            <div className="form-row">
              <Field label="Name">
                <input className="input" value={draft.name} disabled={readOnly} maxLength={32} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Developer" />
              </Field>
              <Field label="Color">
                <div className="swatches">
                  {COLORS.map((c) => (
                    <button
                      key={c ?? 'none'}
                      type="button"
                      disabled={readOnly}
                      className={cx('swatch', draft.color === c && 'active', !c && 'swatch-none')}
                      style={c ? { background: c } : undefined}
                      onClick={() => setDraft({ ...draft, color: c })}
                      aria-label={c ?? 'No color'}
                    />
                  ))}
                </div>
              </Field>
            </div>

            <div className="field">
              <span className="field-label">Permissions</span>
              {isOwn && !readOnly && <span className="field-hint">This is your own role. You can rename it, but not change its permissions.</span>}
              <ul className="perm-list">
                {meta?.permissions.map((p) => {
                  const checked = draft.permissions.includes(p.key) || draft.permissions.includes('admin')
                  const impliedByAdmin = p.key !== 'admin' && draft.permissions.includes('admin')
                  const disabled = readOnly || isOwn || impliedByAdmin || !covers(me.permissions, [p.key])
                  return (
                    <li key={p.key}>
                      <label className={cx('perm', disabled && 'perm-disabled')}>
                        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(p.key)} />
                        <span className="stack">
                          <span>{p.label}</span>
                          <span className="muted small">{p.description}</span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>

            {!readOnly && (
              <div className="editor-actions">
                {role && !role.isDefault && !isOwn && (
                  <ConfirmButton confirmText={role.memberCount ? `Delete and move ${role.memberCount} to default?` : 'Delete role?'} onConfirm={remove}>
                    Delete role
                  </ConfirmButton>
                )}
                {role?.isDefault && <span className="muted small">New members get this role. Change the default in Settings.</span>}
                <span className="grow" />
                {selected === NEW && (
                  <button className="btn btn-ghost" onClick={() => setSelected(roles[0]?.id ?? null)}>
                    Cancel
                  </button>
                )}
                <button className="btn btn-primary" disabled={busy || !dirty || !draft.name.trim()} onClick={save}>
                  {selected === NEW ? 'Create role' : 'Save changes'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
