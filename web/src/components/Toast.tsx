import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { errorMessage } from '../api.ts'
import { cx } from '../util.ts'

type Toast = { id: number; text: string; kind: 'error' | 'info' }
type Notify = { error: (err: unknown) => void; info: (text: string) => void }

const ToastContext = createContext<Notify | null>(null)
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: Toast['kind']) => {
    const id = nextId++
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const [notify] = useState<Notify>(() => ({
    error: (err) => push(errorMessage(err), 'error'),
    info: (text) => push(text, 'info'),
  }))

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', t.kind === 'error' && 'toast-error')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}
