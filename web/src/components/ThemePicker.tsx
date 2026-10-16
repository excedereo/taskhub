import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, ImagePlus, Paintbrush, Pencil, Plus, Sparkles } from 'lucide-react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import { previewTheme, readPrefs, savePrefs, syncWorkspaceThemes, usePrefs, type WorkspaceTheme } from '../prefs.ts'
import { BASE_COLORS, BUILTIN_THEMES, COLOR_FIELDS, swatchOf, type ThemeBase, type ThemeColors, type ThemeDef } from '../themes.ts'
import { cx } from '../util.ts'
import { ColorPicker } from './ColorPicker.tsx'
import { ConfirmButton, Modal } from './ui.tsx'
import { useToast } from './Toast.tsx'

const choose = (theme: string, extra: Partial<ReturnType<typeof readPrefs>> = {}) => savePrefs({ ...readPrefs(), theme, ...extra })

const MAIN: { key: string; label: string; hint: string; swatch?: string[] }[] = [
  { key: 'system', label: 'System', hint: 'Follows your device', swatch: ['#ffffff', '#18181b'] },
  { key: 'light', label: 'Light', hint: 'Always light', swatch: ['#ffffff', '#f4f4f5'] },
  { key: 'dark', label: 'Dark', hint: 'Always dark', swatch: ['#18181b', '#0f0f11'] },
  { key: 'custom', label: 'Custom', hint: 'Your own colors' },
]

const gradient = ([a, b]: string[]) => `linear-gradient(135deg, ${a} 50%, ${b} 50%)`

/** Theme choice: four main cards, your own Custom colors, and a folded list of built-in and workspace themes. */
export function ThemePicker() {
  const prefs = usePrefs()
  const { can } = useData()
  const toast = useToast()
  const canManage = can('manage_themes')
  const [themes, setThemes] = useState<WorkspaceTheme[] | null>(null)
  const extra = prefs.theme.startsWith('builtin:') || prefs.theme.startsWith('ws:')
  // Unfolded while one of its themes is chosen, until the person folds it themselves.
  const [folded, setOpen] = useState<boolean | null>(null)
  const open = folded ?? extra
  const [editing, setEditing] = useState<{ theme: WorkspaceTheme | null; start: ThemeDef } | null>(null)

  const reload = useCallback(
    () =>
      api.get<WorkspaceTheme[]>('/themes').then((list) => {
        setThemes(list)
        syncWorkspaceThemes(list)
      }),
    [],
  )
  useEffect(() => {
    reload().catch(toast.error)
  }, [reload, toast])

  const count = BUILTIN_THEMES.length + (themes?.length ?? 0)

  return (
    <div className="field">
      <span className="field-label">Theme</span>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {MAIN.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={prefs.theme === t.key}
            className={cx('theme-card', prefs.theme === t.key && 'active')}
            onClick={() => choose(t.key)}
          >
            <span className="theme-swatch" style={{ background: gradient(t.swatch ?? swatchOf(prefs.custom)) }} />
            <span className="stack">
              <span>{t.label}</span>
              <span className="muted small">{t.hint}</span>
            </span>
            {prefs.theme === t.key && <Check size={16} className="theme-check" />}
          </button>
        ))}
      </div>

      {prefs.theme === 'custom' && (
        <CustomEditor def={prefs.custom} canPublish={canManage} onPublish={() => setEditing({ theme: null, start: prefs.custom })} />
      )}

      <button type="button" className={cx('more-themes', open && 'open')} onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={14} />
        More themes
        <span className="muted">{count}</span>
      </button>
      {open && (
        <div className="more-themes-body">
          <ThemeGroup title="Built-in">
            {BUILTIN_THEMES.map((b) => (
              <ThemeTile key={b.key} name={b.name} swatch={swatchOf(b.def)} active={prefs.theme === `builtin:${b.key}`} onPick={() => choose(`builtin:${b.key}`)} />
            ))}
          </ThemeGroup>
          <ThemeGroup title="Workspace" hint={themes?.length === 0 ? (canManage ? 'No workspace themes yet. Create one, or publish your Custom colors.' : 'Nobody has added a workspace theme yet.') : undefined}>
            {themes?.map((t) => (
              <ThemeTile
                key={t.id}
                name={t.name}
                swatch={swatchOf(t)}
                fancy={Boolean(t.css.trim())}
                active={prefs.theme === `ws:${t.id}`}
                onPick={() => choose(`ws:${t.id}`, { wsTheme: t })}
                onEdit={canManage ? () => setEditing({ theme: t, start: t }) : undefined}
              />
            ))}
            {canManage && (
              <button type="button" className="theme-tile theme-tile-new" onClick={() => setEditing({ theme: null, start: { base: 'light', colors: BASE_COLORS.light } })}>
                <Plus size={14} /> New theme
              </button>
            )}
          </ThemeGroup>
        </div>
      )}

      {editing && (
        <WorkspaceThemeEditor
          theme={editing.theme}
          start={editing.start}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            reload().catch(toast.error)
            if (saved && !editing.theme) choose(`ws:${saved.id}`, { wsTheme: saved })
          }}
        />
      )}
    </div>
  )
}

function ThemeGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="theme-group">
      <span className="muted small">{title}</span>
      <div className="theme-tiles">{children}</div>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  )
}

function ThemeTile({ name, swatch, active, fancy, onPick, onEdit }: { name: string; swatch: string[]; active: boolean; fancy?: boolean; onPick: () => void; onEdit?: () => void }) {
  return (
    <div className={cx('theme-tile', active && 'active')}>
      <button type="button" className="theme-tile-pick" role="radio" aria-checked={active} onClick={onPick}>
        <span className="theme-swatch theme-swatch-sm" style={{ background: gradient(swatch) }} />
        <span className="truncate">{name}</span>
        {fancy && <Sparkles size={12} className="muted" aria-label="Has effects" />}
        {active && <Check size={14} className="theme-check" />}
      </button>
      {onEdit && (
        <button type="button" className="icon-btn icon-btn-sm" onClick={onEdit} aria-label={`Edit ${name}`} title="Edit">
          <Pencil size={12} />
        </button>
      )}
    </div>
  )
}

function ColorRows({ def, onChange }: { def: ThemeDef; onChange: (colors: ThemeColors) => void }) {
  return (
    <ul className="theme-colors">
      {COLOR_FIELDS.map((f) => (
        <li key={f.key}>
          <span className="stack min-w-0 grow">
            <span>{f.label}</span>
            <span className="muted small">{f.hint}</span>
          </span>
          <ColorPicker small presets={[def.colors[f.key]]} value={def.colors[f.key]} onChange={(c) => c && onChange({ ...def.colors, [f.key]: c })} />
        </li>
      ))}
    </ul>
  )
}

function BaseSwitch({ value, onChange }: { value: ThemeBase; onChange: (b: ThemeBase) => void }) {
  return (
    <div className="segmented segmented-sm">
      {(['light', 'dark'] as const).map((b) => (
        <button key={b} type="button" className={cx(value === b && 'active')} onClick={() => value !== b && onChange(b)}>
          {b === 'light' ? 'Light base' : 'Dark base'}
        </button>
      ))}
    </div>
  )
}

/** Your own theme. It is saved in this browser as you go, so the page itself is the preview. */
function CustomEditor({ def, canPublish, onPublish }: { def: ThemeDef; canPublish: boolean; onPublish: () => void }) {
  const set = (custom: ThemeDef) => savePrefs({ ...readPrefs(), custom })
  return (
    <div className="theme-editor">
      <div className="row gap-xs wrap">
        <BaseSwitch value={def.base} onChange={(base) => set({ base, colors: BASE_COLORS[base] })} />
        <span className="grow" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ base: def.base, colors: BASE_COLORS[def.base] })}>
          Reset colors
        </button>
        {canPublish && (
          <button type="button" className="btn btn-sm" onClick={onPublish}>
            Save to workspace
          </button>
        )}
      </div>
      <span className="muted small">Switching the base starts from its stock colors. Everything else, like hover and muted text, is mixed from these six.</span>
      <ColorRows def={def} onChange={(colors) => set({ ...def, colors })} />
    </div>
  )
}

/** Create or edit a theme everyone in the workspace can pick. The page previews it while the editor is open. */
function WorkspaceThemeEditor({ theme, start, onClose, onSaved }: { theme: WorkspaceTheme | null; start: ThemeDef; onClose: () => void; onSaved: (t: WorkspaceTheme | null) => void }) {
  const toast = useToast()
  const [name, setName] = useState(theme?.name ?? '')
  const [draft, setDraft] = useState<ThemeDef>({ base: start.base, colors: start.colors, css: theme?.css ?? '' })
  const [busy, setBusy] = useState(false)
  const cssRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    previewTheme(draft)
  }, [draft])
  useEffect(() => () => previewTheme(null), [])

  const save = async () => {
    setBusy(true)
    try {
      const body = { name: name.trim(), base: draft.base, colors: draft.colors, css: draft.css ?? '' }
      const saved = theme ? await api.patch<WorkspaceTheme>(`/themes/${theme.id}`, body) : await api.post<WorkspaceTheme>('/themes', body)
      previewTheme(null)
      onSaved(saved)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!theme) return
    try {
      await api.del(`/themes/${theme.id}`)
      previewTheme(null)
      onSaved(null)
    } catch (err) {
      toast.error(err)
    }
  }

  const upload = async (file: File) => {
    try {
      const res = await fetch('/api/themes/assets', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file, credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? res.statusText)
      const snippet = `url("${data.url}")`
      const el = cssRef.current
      const css = draft.css ?? ''
      const at = el ? el.selectionStart : css.length
      setDraft({ ...draft, css: css.slice(0, at) + snippet + css.slice(at) })
      toast.info('Image uploaded, its url() is in the CSS')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Modal
      title={theme ? `Edit ${theme.name}` : 'New workspace theme'}
      onClose={onClose}
      width={640}
      footer={
        <>
          {theme && (
            <span className="modal-foot-left">
              <ConfirmButton confirmText="Delete for everyone?" onConfirm={remove}>
                Delete
              </ConfirmButton>
            </span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>
            {theme ? 'Save theme' : 'Create theme'}
          </button>
        </>
      }
    >
      <div className="theme-editor theme-editor-modal">
        <div className="row gap-xs wrap">
          <input className="input grow" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Theme name" aria-label="Theme name" />
          <BaseSwitch value={draft.base} onChange={(base) => setDraft({ ...draft, base, colors: BASE_COLORS[base] })} />
        </div>
        <ColorRows def={draft} onChange={(colors) => setDraft({ ...draft, colors })} />
        <div className="field">
          <span className="field-label">
            <Paintbrush size={12} /> Custom CSS
          </span>
          <span className="field-hint">
            For effects. It applies only while this theme is chosen. Start selectors with <code>:root</code> to win over the app's own styles. Images must be uploaded here; links to other sites are blocked. If the page breaks, open it with <code>?safe</code> at the end of the address.
          </span>
          <textarea
            ref={cssRef}
            className="input theme-css"
            spellCheck={false}
            value={draft.css ?? ''}
            onChange={(e) => setDraft({ ...draft, css: e.target.value })}
            placeholder={':root body {\n  background: linear-gradient(120deg, #ff9ad5, #ffc4e6);\n}'}
          />
          <div className="row gap-xs">
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} /> Upload image
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
