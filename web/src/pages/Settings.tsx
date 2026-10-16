import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import type { Settings } from '../types.ts'
import { cx } from '../util.ts'
import { Empty, Field, PageHeader } from '../components/ui.tsx'
import { Select } from '../components/Select.tsx'
import { useToast } from '../components/Toast.tsx'
import { roleOptions } from '../components/ui.tsx'

export function SettingsPage() {
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

  if (!allowed) return <div className="page"><Empty title="You do not have access to settings" /></div>
  if (!form || !saved) return <div className="page" />

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
    <div className="page page-narrow">
      <PageHeader title="Settings" description="Instance-wide options. Changes are recorded in the audit log." />

      <form className="card form" onSubmit={submit}>
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
    </div>
  )
}
