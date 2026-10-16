import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../util.ts'

export const PRESET_COLORS = ['#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#a1a1aa']

// ---- hex <-> HSV, so the picker can show a saturation/brightness square and a hue strip.

function hexToHsv(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
  }
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v)

type Props = {
  value: string | null
  onChange: (color: string | null) => void
  presets?: string[]
  allowNone?: boolean
  disabled?: boolean
  small?: boolean
}

/**
 * Preset swatches plus a rainbow swatch that opens a full picker.
 * A custom colour (not one of the presets) shows inside the rainbow ring.
 */
export function ColorPicker({ value, onChange, presets = PRESET_COLORS, allowNone, disabled, small }: Props) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const custom = value !== null && !presets.some((p) => p.toLowerCase() === value.toLowerCase())

  return (
    <div className="swatches">
      {allowNone && (
        <button type="button" disabled={disabled} className={cx('swatch swatch-none', small && 'swatch-sm', value === null && 'active')} onClick={() => onChange(null)} aria-label="No color" />
      )}
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          className={cx('swatch', small && 'swatch-sm', value?.toLowerCase() === c.toLowerCase() && 'active')}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        className={cx('swatch swatch-rainbow', small && 'swatch-sm', custom && 'active')}
        onClick={() => setOpen((o) => !o)}
        aria-label="Custom color"
        title="Custom color"
      >
        {custom && <span className="swatch-custom" style={{ background: value! }} />}
      </button>
      {open && anchor.current && (
        <AdvancedPicker
          anchor={anchor.current}
          initial={value ?? presets[0]}
          onCancel={() => setOpen(false)}
          onApply={(hex) => {
            setOpen(false)
            onChange(hex)
          }}
        />
      )}
    </div>
  )
}

function AdvancedPicker({ anchor, initial, onApply, onCancel }: { anchor: HTMLElement; initial: string; onApply: (hex: string) => void; onCancel: () => void }) {
  const start = hexToHsv(isHex(initial) ? initial : '#0090ff')
  const [h, setH] = useState(start.h)
  const [s, setS] = useState(start.s)
  const [v, setV] = useState(start.v)
  const hex = hsvToHex(h, s, v)
  const [text, setText] = useState(hex)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const pop = useRef<HTMLDivElement>(null)

  // Keep the text field in sync while dragging, but not while the user is typing in it.
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setText(hex)
  }, [hex])

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const width = 248
    const height = 300
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    const top = r.bottom + 8 + height > window.innerHeight ? Math.max(8, r.top - height - 8) : r.bottom + 8
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onCancel()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onCancel()
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onCancel])

  /** Shared drag handling for the square and the hue strip. */
  const dragger = (apply: (x: number, y: number) => void) => (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const update = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect()
      apply(Math.min(1, Math.max(0, (cx - r.left) / r.width)), Math.min(1, Math.max(0, (cy - r.top) / r.height)))
    }
    typing.current = false
    update(e.clientX, e.clientY)
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => update(ev.clientX, ev.clientY)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const setFromText = (value: string) => {
    typing.current = true
    const next = value.startsWith('#') ? value : `#${value}`
    setText(next)
    if (isHex(next)) {
      const hsv = hexToHsv(next.toLowerCase())
      setH(hsv.h)
      setS(hsv.s)
      setV(hsv.v)
    }
  }

  if (!pos) return null
  return createPortal(
    <div ref={pop} className="color-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="Pick a color">
      <div className="color-sv" style={{ backgroundColor: `hsl(${h} 100% 50%)` }} onPointerDown={dragger((x, y) => (setS(x), setV(1 - y)))}>
        <span className="color-sv-thumb" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex }} />
      </div>
      <div className="color-hue" onPointerDown={dragger((x) => setH(Math.min(359.9, x * 360)))}>
        <span className="color-hue-thumb" style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h} 100% 50%)` }} />
      </div>
      <div className="color-row">
        <span className="color-preview" style={{ background: hex }} />
        <input
          className="input input-sm color-hex"
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => setFromText(e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && isHex(text) && onApply(text.toLowerCase())}
          aria-label="Hex color"
        />
      </div>
      <div className="color-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!isHex(text)} onClick={() => onApply(isHex(text) ? text.toLowerCase() : hex)}>
          Apply
        </button>
      </div>
    </div>,
    document.body,
  )
}
