import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { GripVertical, Hash, Lock, Plus } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe, useSession } from '../store.tsx'
import type { Category, Role } from '../types.ts'
import { covers, cx } from '../util.ts'
import { ConfirmButton, Field, PageHeader } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { ColorPicker } from '../components/ColorPicker.tsx'
import { useOptimisticOrder } from '../components/WorkflowEditors.tsx'


type Draft = { name: string; color: string | null; permissions: string[]; createCategories: number[] | null; viewCategories: number[] | null }
const NEW = 'new'

export function RolesPage() {
  const me = useMe()
  const { meta } = useSession()
  const { roles, categories, can, reloadRoles, reloadUsers } = useData()
  const toast = useToast()
  const [selected, setSelected] = useState<number | typeof NEW | null>(null)
  const [draft, setDraft] = useState<Draft>({ name: '', color: null, permissions: [], createCategories: null, viewCategories: null })
  const [busy, setBusy] = useState(false)

  const canManage = can('manage_roles')
  // Owner is pinned on top; the rest is the hierarchy, dragged by the handle.
  const owner = roles.filter((r) => r.isSystem)
  const movable = useMemo(() => roles.filter((r) => !r.isSystem), [roles])
  const { order, sort } = useOptimisticOrder(movable, (ids) => api.put('/roles/order', { ids }).then(reloadRoles).catch((err) => {
    toast.error(err)
    reloadRoles()
  }))
  const role = typeof selected === 'number' ? roles.find((r) => r.id === selected) : undefined

  useEffect(() => {
    if (selected === null && roles.length) setSelected(roles[0].id)
  }, [roles, selected])

  useEffect(() => {
    // A limited editor starts new roles with their own limit, since they cannot hand out more.
    if (selected === NEW) setDraft({ name: '', color: null, permissions: [], createCategories: myLimit, viewCategories: myView })
    else if (role) setDraft({ name: role.name, color: role.color, permissions: role.permissions, createCategories: role.createCategories, viewCategories: role.viewCategories })
  }, [selected, role])

  const isOwn = role?.id === me.roleId
  const myLimit = me.permissions.includes('admin') ? null : me.createCategoryIds
  const myView = me.permissions.includes('admin') ? null : me.viewCategoryIds
  const sameLimit = (a: number[] | null, b: number[] | null) => (a === null || b === null ? a === b : [...a].sort().join() === [...b].sort().join())
  // Why the editor is read-only, if it is.
  const lock = !canManage
    ? 'You can view roles but not change them.'
    : role?.isSystem
      ? 'The Owner role always has every permission and cannot be changed.'
      : role && !covers(me.permissions, role.permissions)
        ? 'This role has permissions you do not have, so you cannot edit it.'
        : role && myView !== null && (role.viewCategories === null || role.viewCategories.some((id) => !myView.includes(id)))
          ? 'This role can see categories you cannot, so you cannot edit it.'
        : role && myLimit !== null && (role.createCategories === null || role.createCategories.some((id) => !myLimit.includes(id)))
          ? 'This role can create tasks in categories you cannot, so you cannot edit it.'
          : null
  const readOnly = Boolean(lock)

  const dirty = selected === NEW || (role && (draft.name !== role.name || draft.color !== role.color || [...draft.permissions].sort().join() !== [...role.permissions].sort().join() || !sameLimit(draft.createCategories, role.createCategories) || !sameLimit(draft.viewCategories, role.viewCategories)))

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
          body.viewCategories = draft.viewCategories
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

  if (!canManage) return <Navigate to="/tasks" replace />

  return (
    <div className="page">
      <PageHeader
        title="Roles"
        description="Roles decide what people can do. Everyone has exactly one role. Drag roles to set their order: higher roles are listed first everywhere."
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
          {owner.map((r) => (
            <li key={r.id} className="role-li">
              {canManage && <span className="grip grip-placeholder" />}
              <RoleItem role={r} active={selected === r.id} onClick={() => setSelected(r.id)} />
            </li>
          ))}
          {order.map((r, i) => (
            <li key={r.id} ref={sort.ref(i)} style={sort.style(i)} className={cx('role-li', sort.dragging === i && 'is-dragging')}>
              {canManage && (
                <button type="button" className="grip" aria-label={`Drag ${r.name}`} title="Drag to reorder" {...sort.handle(i)}>
                  <GripVertical size={14} />
                </button>
              )}
              <RoleItem role={r} active={selected === r.id} onClick={() => setSelected(r.id)} />
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
                <ColorPicker allowNone value={draft.color} disabled={readOnly} onChange={(color) => setDraft({ ...draft, color })} />
              </Field>
            </div>

            {!draft.permissions.includes('admin') && (
              <div className="field">
                <span className="field-label">Visible categories</span>
                {isOwn && !readOnly && <span className="field-hint">This is your own role, so its visibility cannot be changed here.</span>}
                <div className="perm-list perm-limit-box">
                  <CategoryLimit
                    value={draft.viewCategories}
                    onChange={(viewCategories) => setDraft({ ...draft, viewCategories })}
                    disabled={readOnly || isOwn}
                    allowed={myView}
                    categories={categories}
                    emptyHint="Pick at least one, otherwise this role sees no tasks at all."
                  />
                </div>
              </div>
            )}

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

function RoleItem({ role: r, active, onClick }: { role: Role; active: boolean; onClick: () => void }): ReactNode {
  return (
    <button className={cx('role-item', active && 'active')} onClick={onClick}>
      <span className="dot" style={{ background: r.color ?? 'var(--text-faint)' }} />
      <span className="truncate">{r.name}</span>
      {r.isSystem && <Lock size={12} className="muted" />}
      {r.isDefault && <span className="badge badge-sm">Default</span>}
      <span className="muted small role-count">{r.memberCount}</span>
    </button>
  )
}

/** "All categories" or a hand-picked list; an editor can only pick categories they may create in themselves. */
export function CategoryLimit({ value, onChange, disabled, allowed, categories, emptyHint = 'Pick at least one, otherwise this role cannot create tasks anywhere.' }: {
  value: number[] | null
  onChange: (v: number[] | null) => void
  disabled: boolean
  allowed: number[] | null
  categories: Category[]
  emptyHint?: string
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
          {value.length === 0 && <span className="muted small">{emptyHint}</span>}
        </div>
      )}
    </div>
  )
}
