import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { ICONS, ICON_KEYS } from '../icons.ts'
import { cx } from '../util.ts'

/** A small square button showing the current icon; opens a searchable grid of the workspace icon set. */
export function IconPicker({ value, color, onChange, disabled, fallback = 'circle' }: { value: string | null; color: string; onChange: (icon: string) => void; disabled?: boolean; fallback?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const Current = ICONS[value ?? fallback] ?? ICONS[fallback]

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    const width = 292
    const height = 300
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: r.bottom + 6 + height > window.innerHeight ? Math.max(8, r.top - height - 6) : r.bottom + 6,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const keys = ICON_KEYS.filter((k) => k.includes(query.trim().toLowerCase()))

  return (
    <>
      <button ref={anchor} type="button" className="icon-pick" disabled={disabled} onClick={() => (setOpen((o) => !o), setQuery(''))} aria-label="Choose icon" title="Choose icon">
        <Current size={16} color={color} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={pop} className="icon-pop" style={{ left: pos.left, top: pos.top }}>
            <label className="select-search">
              <Search size={14} />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons…" />
            </label>
            <div className="icon-grid">
              {keys.map((k) => {
                const Icon = ICONS[k]
                return (
                  <button
                    key={k}
                    type="button"
                    className={cx('icon-cell', (value ?? fallback) === k && 'active')}
                    onClick={() => {
                      onChange(k)
                      setOpen(false)
                    }}
                    title={k}
                    aria-label={k}
                  >
                    <Icon size={18} color={color} />
                  </button>
                )
              })}
              {!keys.length && <span className="muted small icon-empty">No icons match</span>}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
