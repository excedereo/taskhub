import { useEffect, useState, type FormEvent } from 'react'
import { api, IMAGE_TYPES } from '../api.ts'
import { useData, useSession } from '../store.tsx'
import type { Settings } from '../types.ts'
import { cx } from '../util.ts'
import { BrandMark, ConfirmButton, Field, LabelChip, PageHeader } from '../components/ui.tsx'
import { Navigate } from 'react-router-dom'
import type { Label } from '../types.ts'
import { Select } from '../components/Select.tsx'
import { useToast } from '../components/Toast.tsx'
import { ColorPicker } from '../components/ColorPicker.tsx'
import { PrioritiesEditor, StatusesEditor } from '../components/WorkflowEditors.tsx'
import { roleOptions } from '../components/ui.tsx'

/** Workspace-wide settings. Each section shows up for the permission that controls it. */
export function SettingsPage() {
  const { can } = useData()
  const canSettings = can('manage_settings')
  const canLabels = can('manage_categories')
  if (!canSettings && !canLabels) return <Navigate to="/tasks" replace />
  return (
    <div className="page page-narrow">
      <PageHeader title="Workspace settings" description="Applies to everyone. Changes are recorded in the audit log." />
      {canSettings && (
        <>
          <LogoField />
          <WorkspaceForm />
          <StatusesEditor />
          <PrioritiesEditor />
        </>
      )}
      {canLabels && <LabelsManager />}
    </div>
  )
}

function WorkspaceForm() {
  const { roles, can, reloadRoles } = useData()
  const toast = useToast()
  const [saved, setSaved] = useState<Settings | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const allowed = can('manage_settings')

  useEffect(() => {
    if (!allowed) return
    api.get<Settings>('/settings').then((s) => {
      setSaved(s)
      setForm(s)
    }).catch(toast.error)
  }, [allowed, toast])

  if (!allowed || !form || !saved) return null

  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const s = await api.patch<Settings>('/settings', form)
      setSaved(s)
      setForm(s)
      await reloadRoles()
      // The name is shown in the sidebar and tab title, both read from /meta on load.
      if (s.instanceName !== saved.instanceName) window.location.reload()
      else toast.info('Settings saved')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
      <form className="card form" data-tour="workspace-form" onSubmit={submit}>
        <Field label="Instance name" hint="Shown in the sidebar, the sign-in page and the browser tab.">
          <input className="input" value={form.instanceName} maxLength={40} onChange={(e) => setForm({ ...form, instanceName: e.target.value })} />
        </Field>

        <div className="field">
          <span className="field-label">Who can sign in</span>
          <div className="choice-list">
            {[
              { key: 'invite' as const, title: 'Invited only', text: 'Only people added on the Users page can sign in. Recommended.' },
              { key: 'open' as const, title: 'Anyone with Discord', text: 'Any Discord account can sign in and joins with the default role.' },
            ].map((o) => (
              <label key={o.key} className={cx('choice', form.registration === o.key && 'active')}>
                <input type="radio" name="registration" checked={form.registration === o.key} onChange={() => setForm({ ...form, registration: o.key })} />
                <span className="stack">
                  <span>{o.title}</span>
                  <span className="muted small">{o.text}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <Field label="Default role" hint="Given to new users unless someone picks another role when adding them.">
          <Select aria-label="Default role" value={form.defaultRoleId} onChange={(defaultRoleId) => setForm({ ...form, defaultRoleId })} options={roleOptions(roles.filter((r) => !r.isSystem))} />
        </Field>

        <div className="editor-actions">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => setForm(saved)}>
            Reset
          </button>
          <button className="btn btn-primary" disabled={busy || !dirty || !form.instanceName.trim()}>
            Save settings
          </button>
        </div>
      </form>
  )
}

/** Uploaded on its own (not with the form), so a new logo shows up right away everywhere. */
function LogoField() {
  const { meta, refreshMeta } = useSession()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!meta) return null

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const res = await fetch('/api/settings/logo', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file, credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      await refreshMeta()
      toast.info('Logo updated')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.del('/settings/logo')
      await refreshMeta()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card logo-field">
      <BrandMark logoUrl={meta.logoUrl} large />
      <div className="stack grow">
        <span>Logo</span>
        <span className="muted small">Square PNG, JPEG, WebP or GIF up to 2 MB. Used in the sidebar, on the sign-in page and as the tab icon.</span>
      </div>
      <label className={cx('btn', busy && 'btn-disabled')}>
        {meta.logoUrl ? 'Replace' : 'Upload'}
        <input
          type="file"
          accept={IMAGE_TYPES.join(',')}
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) upload(file)
          }}
        />
      </label>
      {meta.logoUrl && (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={remove}>
          Remove
        </button>
      )}
    </div>
  )
}

const LABEL_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#a1a1aa']

/** Create, rename, recolor and delete labels. Deleting removes the label from its tasks. */
function LabelsManager() {
  const { labels, reloadLabels } = useData()
  const toast = useToast()
  const [name, setName] = useState('')

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await reloadLabels()
    } catch (err) {
      toast.error(err)
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    run(() => api.post<Label>('/labels', { name: name.trim(), color: LABEL_COLORS[labels.length % 8] })).then(() => setName(''))
  }

  return (
    <section className="card form labels-card" data-tour="labels">
      <div className="stack">
        <span>Labels</span>
        <span className="muted small">Group tasks across categories, for example "UI", "Server" or "Balance".</span>
      </div>
      <form className="row gap-xs" onSubmit={add}>
        <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="New label" />
        <button className="btn" disabled={!name.trim()}>
          Add
        </button>
      </form>
      {labels.length > 0 && (
        <ul className="label-admin">
          {labels.map((l) => (
            <li key={l.id}>
              <ColorPicker small value={l.color} presets={LABEL_COLORS} onChange={(color) => color && run(() => api.patch(`/labels/${l.id}`, { color }))} />
              <input
                className="input input-inline"
                defaultValue={l.name}
                maxLength={32}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.name && run(() => api.patch(`/labels/${l.id}`, { name: e.target.value.trim() }))}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                aria-label="Label name"
              />
              <LabelChip label={l} />
              <span className="muted small num">{l.taskCount} {l.taskCount === 1 ? 'task' : 'tasks'}</span>
              <ConfirmButton className="btn-sm" confirmText={l.taskCount ? `Remove from ${l.taskCount}?` : 'Delete?'} onConfirm={() => run(() => api.del(`/labels/${l.id}`))}>
                Delete
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
