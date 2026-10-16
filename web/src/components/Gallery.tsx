import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, ImagePlus, Trash2, X } from 'lucide-react'
import { IMAGE_TYPES } from '../api.ts'
import { cx } from '../util.ts'

export type GalleryItem = {
  key: string
  src: string
  name: string
  width: number | null
  height: number | null
  size?: number
  meta?: ReactNode
  pending?: boolean
  removable?: boolean
  downloadUrl?: string
}

type Props = {
  items: GalleryItem[]
  onRemove?: (item: GalleryItem) => void
  onAdd?: (files: File[]) => void
  rowHeight?: number
}

// Very tall or very wide images would make rows useless, so their tiles are clamped and cropped a little.
const clampRatio = (w: number | null, h: number | null) => Math.min(3.2, Math.max(0.6, w && h ? w / h : 4 / 3))

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Justified image grid: tiles keep their aspect ratio and rows fill the width, nothing gets squashed. */
export function Gallery({ items, onRemove, onAdd, rowHeight = 120 }: Props) {
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    if (open !== null && open >= items.length) setOpen(items.length ? items.length - 1 : null)
  }, [items.length, open])

  if (!items.length && !onAdd) return null

  return (
    <>
      <div className="gallery">
        {items.map((item, i) => {
          const ratio = clampRatio(item.width, item.height)
          return (
            <div key={item.key} className={cx('gallery-item', item.pending && 'pending')} style={{ flexGrow: ratio, flexBasis: ratio * rowHeight, aspectRatio: ratio }}>
              <button type="button" className="gallery-open" onClick={() => !item.pending && setOpen(i)} aria-label={`Open ${item.name}`}>
                <img src={item.src} alt={item.name} loading="lazy" draggable={false} />
              </button>
              {item.pending && <span className="gallery-spinner" aria-label="Uploading" />}
              {item.removable && onRemove && !item.pending && (
                <button type="button" className="gallery-remove" onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`} title="Remove">
                  <X size={14} />
                </button>
              )}
            </div>
          )
        })}
        {onAdd && (
          <label className="gallery-add" style={{ flexBasis: rowHeight, height: rowHeight }} title="Add images (you can also paste or drop them)">
            <ImagePlus size={20} />
            <span>Add images</span>
            <input
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (files.length) onAdd(files)
              }}
            />
          </label>
        )}
      </div>

      {open !== null && items[open] && (
        <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onRemove={onRemove} />
      )}
    </>
  )
}

function Lightbox({ items, index, onIndex, onClose, onRemove }: {
  items: GalleryItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onRemove?: (item: GalleryItem) => void
}) {
  const item = items[index]
  const many = items.length > 1
  const prev = () => onIndex((index - 1 + items.length) % items.length)
  const next = () => onIndex((index + 1) % items.length)

  useEffect(() => {
    // Capture phase: keys here must not also close the task panel underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && many) prev()
      else if (e.key === 'ArrowRight' && many) next()
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
    }
  })

  return createPortal(
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="lightbox-bar">
        <div className="lightbox-info">
          <span className="truncate">{item.name}</span>
          <span className="lightbox-meta">
            {many && `${index + 1} / ${items.length}`}
            {item.size !== undefined && ` · ${formatBytes(item.size)}`}
            {item.width && item.height && ` · ${item.width}×${item.height}`}
            {item.meta && <> · {item.meta}</>}
          </span>
        </div>
        <div className="lightbox-actions">
          {item.downloadUrl && (
            <a className="lightbox-btn" href={item.downloadUrl} title="Download" aria-label="Download">
              <Download size={18} />
            </a>
          )}
          {item.removable && onRemove && (
            <button className="lightbox-btn" onClick={() => onRemove(item)} title="Remove" aria-label="Remove">
              <Trash2 size={18} />
            </button>
          )}
          <button className="lightbox-btn" onClick={onClose} title="Close" aria-label="Close">
            <X size={20} />
          </button>
        </div>
      </div>

      <img key={item.key} className="lightbox-img" src={item.src} alt={item.name} onMouseDown={(e) => e.stopPropagation()} />

      {many && (
        <>
          <button className="lightbox-nav lightbox-prev" onMouseDown={(e) => e.stopPropagation()} onClick={prev} aria-label="Previous image">
            <ChevronLeft size={24} />
          </button>
          <button className="lightbox-nav lightbox-next" onMouseDown={(e) => e.stopPropagation()} onClick={next} aria-label="Next image">
            <ChevronRight size={24} />
          </button>
          <div className="lightbox-strip" onMouseDown={(e) => e.stopPropagation()}>
            {items.map((it, i) => (
              <button key={it.key} className={cx('lightbox-thumb', i === index && 'active')} onClick={() => onIndex(i)} aria-label={`Show ${it.name}`}>
                <img src={it.src} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body,
  )
}
