import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

type Drag = { from: number; to: number; dy: number; shift: number }

const EDGE = 72
const SCROLL_STEP = 14

/**
 * Vertical drag-to-reorder for a list, driven by a handle.
 * Items are not moved in the DOM while dragging: the dragged one follows the pointer and the
 * ones it passes slide out of the way with transforms. The real move happens once, on drop.
 */
export function useDragSort(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDragState] = useState<Drag | null>(null)
  const current = useRef<Drag | null>(null)
  const setDrag = (d: Drag | null) => {
    current.current = d
    setDragState(d)
  }
  // True for the frame in which the new order lands: transitions are off so nothing slides from its old offset.
  const [settling, setSettling] = useState(false)
  useEffect(() => {
    if (!settling) return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
    return () => cancelAnimationFrame(id)
  }, [settling])
  const items = useRef<(HTMLElement | null)[]>([])
  const start = useRef({ y: 0, scroll: 0, mids: [] as number[], from: 0, shift: 0 })
  const moveRef = useRef(onMove)
  useEffect(() => {
    moveRef.current = onMove
  })

  const scroller = () => document.querySelector<HTMLElement>('.main')

  const onPointerDown = useCallback(
    (index: number) => (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      const rects = items.current.slice(0, count).map((el) => el?.getBoundingClientRect())
      const own = rects[index]
      if (!own) return
      const next = rects[index + 1] ?? rects[index - 1]
      // Distance the neighbours slide by: the dragged item's height plus the gap between rows.
      const gap = next ? Math.abs(next.top > own.top ? next.top - own.bottom : own.top - next.bottom) : 4
      start.current = {
        y: e.clientY,
        scroll: scroller()?.scrollTop ?? 0,
        mids: rects.map((r) => (r ? r.top + r.height / 2 : 0)),
        from: index,
        shift: own.height + gap,
      }
      setDrag({ from: index, to: index, dy: 0, shift: own.height + gap })
      document.body.classList.add('dragging')

      const move = (ev: globalThis.PointerEvent) => {
        const main = scroller()
        if (main) {
          if (ev.clientY < EDGE) main.scrollBy(0, -SCROLL_STEP)
          else if (ev.clientY > window.innerHeight - EDGE) main.scrollBy(0, SCROLL_STEP)
        }
        const { y, scroll, mids, from, shift } = start.current
        // Scrolling moves the list under the pointer, so it counts as movement too.
        const dy = ev.clientY - y + ((main?.scrollTop ?? 0) - scroll)
        const center = mids[from] + dy
        let to = from
        while (to < mids.length - 1 && center > mids[to + 1]) to++
        while (to > 0 && center < mids[to - 1]) to--
        setDrag({ from, to, dy, shift })
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        document.body.classList.remove('dragging')
        const d = current.current
        setSettling(true)
        setDrag(null)
        if (d && d.to !== d.from) moveRef.current(d.from, d.to)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [count],
  )

  /** Keyboard fallback on the handle: arrow keys move the item one step. */
  const onKeyDown = useCallback(
    (index: number) => (e: KeyboardEvent<HTMLElement>) => {
      const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null
      if (to === null || to < 0 || to >= count) return
      e.preventDefault()
      moveRef.current(index, to)
      // Keep focus on the handle that just moved, so repeated presses keep moving it.
      requestAnimationFrame(() => items.current[to]?.querySelector<HTMLElement>('.grip')?.focus())
    },
    [count],
  )

  const style = (index: number): CSSProperties => {
    if (!drag) return settling ? { transition: 'none' } : {}
    const { from, to, dy, shift } = drag
    if (index === from) return { transform: `translateY(${dy}px)`, position: 'relative', zIndex: 3, transition: 'none' }
    if (from < to && index > from && index <= to) return { transform: `translateY(${-shift}px)` }
    if (to < from && index >= to && index < from) return { transform: `translateY(${shift}px)` }
    return { transform: 'translateY(0)' }
  }

  return {
    dragging: drag?.from ?? null,
    ref: (index: number) => (el: HTMLElement | null) => {
      items.current[index] = el
    },
    style,
    handle: (index: number) => ({ onPointerDown: onPointerDown(index), onKeyDown: onKeyDown(index) }),
  }
}

export function moveItem<T>(list: T[], from: number, to: number) {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
