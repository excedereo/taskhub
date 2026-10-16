import { useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }

/** A textarea that grows with its content. `minRows` keeps the resting height. */
export function AutoTextarea({ minRows = 3, style, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + border}px`
  }

  useLayoutEffect(fit, [props.value])

  // Width changes reflow the text, so the height has to follow.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        fit()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return <textarea ref={ref} rows={minRows} style={{ ...style, resize: 'none', overflow: 'hidden' }} {...props} />
}
