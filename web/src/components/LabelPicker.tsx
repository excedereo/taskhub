import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Search, Tag } from 'lucide-react'
import { api } from '../api.ts'
import { useData } from '../store.tsx'
import type { Label } from '../types.ts'
import { cx } from '../util.ts'
import { LabelChip } from './ui.tsx'
import { useToast } from './Toast.tsx'

// New labels cycle through the validated chart palette, so they stay distinguishable.
const LABEL_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

/** Multi-select for labels. People who manage labels can also create one by typing its name. */
export function LabelPicker({ value, onChange, disabled, variant = 'ghost' }: { value: number[]; onChange: (ids: number[]) => void; disabled?: boolean; variant?: 'ghost' | 'default' }) {
  const { labels, labelById, can, reloadLabels } = useData()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const width = Math.max(r.width, 240)
    const left = Math.min(r.left, window.innerWidth - width - 8)
    const below = window.innerHeight - r.bottom
    setPos(below < 300 && r.top > below ? { left, bottom: window.innerHeight - r.top + 4, width } : { left, top: r.bottom + 4, width })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const q = query.trim()
  const matches = labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
  const canCreate = can('manage_categories') && q.length > 0 && !labels.some((l) => l.name.toLowerCase() === q.toLowerCase())
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  const create = async () => {
    try {
      const label = await api.post<Label>('/labels', { name: q, color: LABEL_COLORS[labels.length % LABEL_COLORS.length] })
      await reloadLabels()
      onChange([...value, label.id])
      setQuery('')
    } catch (err) {
      toast.error(err)
    }
  }

  const chosen = value.map((id) => labelById.get(id)).filter((l): l is Label => Boolean(l))

  return (
    <>
      <button ref={triggerRef} type="button" className={cx('select', `select-${variant}`, 'label-trigger', open && 'select-open')} disabled={disabled} onClick={() => (open ? close() : setOpen(true))} aria-haspopup="listbox" aria-expanded={open}>
        {chosen.length ? (
          <span className="label-row">
            {chosen.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </span>
        ) : (
          <span className="select-value select-placeholder">
            <Tag size={13} /> {disabled ? 'None' : 'Add labels'}
          </span>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="select-pop" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: 340 }}>
            <label className="select-search">
              <Search size={14} />
              <input
                autoFocus
                value={query}
                placeholder={can('manage_categories') ? 'Search or create…' : 'Search…'}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  if (matches.length === 1) toggle(matches[0].id)
                  else if (canCreate) create()
                }}
              />
            </label>
            <ul className="select-list" role="listbox" aria-multiselectable="true">
              {matches.map((l) => (
                <li key={l.id} role="option" aria-selected={value.includes(l.id)} className="select-option" onClick={() => toggle(l.id)}>
                  <span className="dot" style={{ background: l.color }} />
                  <span className="select-option-text">
                    <span className="truncate">{l.name}</span>
                  </span>
                  {value.includes(l.id) && <Check size={14} className="select-check" />}
                </li>
              ))}
              {canCreate && (
                <li className="select-option" onClick={create}>
                  <Plus size={14} className="muted" />
                  <span className="select-option-text">
                    <span className="truncate">Create “{q}”</span>
                  </span>
                </li>
              )}
              {!matches.length && !canCreate && <li className="select-empty">{labels.length ? 'No matches' : 'No labels yet'}</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}
