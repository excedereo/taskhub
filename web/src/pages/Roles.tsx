import { useEffect, useState } from 'react'
import { Hash, Lock, Plus } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe, useSession } from '../store.tsx'
import type { Category, Role } from '../types.ts'
import { covers, cx } from '../util.ts'
import { ConfirmButton, Field, PageHeader } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'

const COLORS = [null, '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f']

type Draft = { name: string; color: string | null; permissions: string[]; createCategories: number[] | null }
const NEW = 'new'

export function RolesPage() {
  const me = useMe()
  const { meta } = useSession()
  const { roles, categories, can, reloadRoles, reloadUsers } = useData()
  const toast = useToast()
  const [selected, setSelected] = useState<number | typeof NEW | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', color: null, permissions: [], createCategories: null })
  const [busy, setBusy] = useState(false)

  const canManage = can('manage_roles')
  const role = typeof selected === 'number' ? roles.find((r) => r.id === selected) : undefined

  useEffect(() => {
    if (selected === null && roles.length) setSelected(roles[0].id)
  }, [roles, selected])

  useEffect(() => {
    // A limited editor starts new roles with their own limit, since they cannot hand out more.
    if (selected === NEW) setDraft({ name: '', color: null, permissions: [], createCategories: myLimit })
    else if (role) setDraft({ name: role.name, color: role.color, permissions: role.permissions, createCategories: role.createCategories })
  }, [selected, role])

  const isOwn = role?.id === me.roleId
  const myLimit = me.permissions.includes('admin') ? null : me.createCategoryIds
  const sameLimit = (a: number[] | null, b: number[] | null) => (a === null || b === null ? a === b : [...a].sort().join() === [...b].sort().join())
  // Why the editor is read-only, if it is.
  const lock = !canManage
    ? 'You can view roles but not change them.'
    : role?.isSystem
      ? 'The Owner role always has every permission and cannot be changed.'
      : role && !covers(me.permissions, role.permissions)
        ? 'This role has permissions you do not have, so you cannot edit it.'
        : role && myLimit !== null && (role.createCategories === null || role.createCategories.some((id) => !myLimit.includes(id)))
          ? 'This role can create tasks in categories you cannot, so you cannot edit it.'
          : null
  const readOnly = Boolean(lock)

  const dirty = selected === NEW || (role && (draft.name !== role.name || draft.color !== role.color || [...draft.permissions].sort().join() !== [...role.permissions].sort().join() || !sameLimit(draft.createCategories, role.createCategories)))

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
        if (!isOwn) {
          body.permissions = draft.permissions
          body.createCategories = draft.createCategories
        }
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
                      {p.key === 'create_tasks' && checked && !draft.permissions.includes('admin') && (
                        <CategoryLimit
                          value={draft.createCategories}
                          onChange={(createCategories) => setDraft({ ...draft, createCategories })}
                          disabled={readOnly || isOwn}
                          allowed={myLimit}
                          categories={categories}
                        />
                      )}
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

/** "All categories" or a hand-picked list; an editor can only pick categories they may create in themselves. */
function CategoryLimit({ value, onChange, disabled, allowed, categories }: {
  value: number[] | null
  onChange: (v: number[] | null) => void
  disabled: boolean
  allowed: number[] | null
  categories: Category[]
}) {
  const options = categories.filter((c) => (!c.archived || value?.includes(c.id)) && (allowed === null || allowed.includes(c.id)))
  const toggle = (id: number) => onChange(value?.includes(id) ? value.filter((x) => x !== id) : [...(value ?? []), id])

  return (
    <div className="perm-limit">
      <div className="segmented">
        <button type="button" className={cx(value === null && 'active')} disabled={disabled || allowed !== null} onClick={() => onChange(null)}>
          All categories
        </button>
        <button type="button" className={cx(value !== null && 'active')} disabled={disabled} onClick={() => value === null && onChange([])}>
          Only selected
        </button>
      </div>
      {value !== null && (
        <div className="chips">
          {options.map((c) => (
            <label key={c.id} className={cx('chip', value.includes(c.id) && 'active', disabled && 'perm-disabled')}>
              <input type="checkbox" checked={value.includes(c.id)} disabled={disabled} onChange={() => toggle(c.id)} />
              <Hash size={12} /> {c.name}
            </label>
          ))}
          {value.length === 0 && <span className="muted small">Pick at least one, otherwise this role cannot create tasks anywhere.</span>}
        </div>
      )}
    </div>
  )
}
