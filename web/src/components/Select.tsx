import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cx } from '../util.ts'

export type SelectOption<T> = {
  value: T
  label: string
  icon?: ReactNode
  hint?: string
}

type Props<T> = {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  variant?: 'default' | 'ghost' | 'sm'
  disabled?: boolean
  placeholder?: string
  'aria-label'?: string
  className?: string
}

const SEARCH_THRESHOLD = 8
const GAP = 4

/** Accessible custom select: a button that opens a listbox in a portal, so it is never clipped by scroll containers. */
export function Select<T extends string | number | null>({ value, options, onChange, variant = 'default', disabled, placeholder = 'Select…', className, ...rest }: Props<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value)
  const searchable = options.length > SEARCH_THRESHOLD
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  const close = (refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) triggerRef.current?.focus()
  }

  const openList = () => {
    if (disabled) return
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  const pick = (option: SelectOption<T> | undefined) => {
    if (!option) return
    close()
    if (option.value !== value) onChange(option.value)
  }

  // Place the popover under the trigger, or above it when there is more room there.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - GAP - 8
      const above = r.top - GAP - 8
      const width = Math.max(r.width, 200)
      const left = Math.min(r.left, window.innerWidth - width - 8)
      const flip = below < 220 && above > below
      setPos(flip
        ? { left, bottom: window.innerHeight - r.top + GAP, width, maxHeight: Math.min(320, above) }
        : { left, top: r.bottom + GAP, width, maxHeight: Math.min(320, below) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (searchable) searchRef.current?.focus()
    else listRef.current?.focus()

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false)
    }
    // Capture phase, so Escape closes only this list and not the modal or panel around it.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, searchable])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      setActive(0)
    } else if (e.key === 'End') {
      setActive(filtered.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(filtered[active])
    } else if (e.key === 'Tab') {
      close(false)
    }
  }

  const onTriggerKey = (e: KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      openList()
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cx('select', `select-${variant}`, open && 'select-open', className)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest['aria-label']}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
      >
        {selected?.icon && <span className="select-icon">{selected.icon}</span>}
        <span className={cx('select-value', !selected && 'select-placeholder')}>{selected?.label ?? placeholder}</span>
        {!(disabled && variant === 'ghost') && <ChevronDown size={14} className="select-chevron" />}
      </button>

      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="select-pop" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}>
            {searchable && (
              <label className="select-search">
                <Search size={14} />
                <input
                  ref={searchRef}
                  value={query}
                  placeholder="Search…"
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                  }}
                  onKeyDown={onListKey}
                />
              </label>
            )}
            <ul ref={listRef} id={listId} role="listbox" tabIndex={-1} className="select-list" onKeyDown={onListKey} aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}>
              {filtered.map((o, i) => (
                <li
                  key={String(o.value)}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={o.value === value}
                  className={cx('select-option', i === active && 'active')}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(o)}
                >
                  {o.icon && <span className="select-icon">{o.icon}</span>}
                  <span className="select-option-text">
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="muted small truncate">{o.hint}</span>}
                  </span>
                  {o.value === value && <Check size={14} className="select-check" />}
                </li>
              ))}
              {filtered.length === 0 && <li className="select-empty">No matches</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}
