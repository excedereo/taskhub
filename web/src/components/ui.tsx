import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Label, Me, Role, Status, User } from '../types.ts'
import { statusLabel } from '../types.ts'
import { useData } from '../store.tsx'
import { avatarUrl, cx, displayName, dueInfo } from '../util.ts'
import { CalendarClock } from 'lucide-react'

export function Avatar({ user, size = 24 }: { user: User | Me | undefined | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  const src = user && !broken ? avatarUrl(user, size * 2) : null
  const name = displayName(user)
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} title={name}>
      {src ? <img src={src} alt="" onError={() => setBroken(true)} /> : name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function UserChip({ user, size = 20 }: { user: User | undefined | null; size?: number }) {
  return (
    <span className="user-chip">
      <Avatar user={user} size={size} />
      <span className="truncate">{displayName(user)}</span>
    </span>
  )
}

/** Ring that fills up as the task moves forward, done is a solid check. */
export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  // The inner pie is a fat stroke on a small circle: radius 2 + half of width 4 reaches r=4.
  const pie = 2 * Math.PI * 2
  const fill = { open: 0, in_progress: 0.5, review: 0.75, done: 1 }[status]
  return (
    <svg className={`status-icon status-${status}`} width={size} height={size} viewBox="0 0 14 14" aria-label={statusLabel(status)} role="img">
      {status === 'done' ? (
        <>
          <circle cx="7" cy="7" r="6.5" fill="currentColor" />
          <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={status === 'open' ? '2 1.6' : undefined} />
          {fill > 0 && (
            <circle cx="7" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={`${pie * fill} ${pie}`} transform="rotate(-90 7 7)" />
          )}
        </>
      )}
    </svg>
  )
}

/**
 * Bars (or a dot, by preference) in the priority's own colour. The number of filled bars follows
 * the priority's place in the list: the most important gets three, the least important one.
 */
export function PriorityIcon({ id }: { id: number }) {
  const { priorities } = useData()
  const index = priorities.findIndex((p) => p.id === id)
  const priority = priorities[index]
  const level = priorities.length < 2 || index < 0 ? 3 : Math.round(3 - (2 * index) / (priorities.length - 1))
  return (
    <svg className="priority-icon" style={{ color: priority?.color }} width="14" height="14" viewBox="0 0 14 14" aria-label={`${priority?.name ?? 'Unknown'} priority`} role="img">
      {/* Both looks are drawn; the "Priority icons" preference shows one of them via CSS. */}
      <g className="pi-bars">
        {[0, 1, 2].map((i) => (
          <rect key={i} x={2 + i * 4} y={9 - i * 3} width="2.5" height={3 + i * 3} rx="0.8" fill="currentColor" opacity={i < level ? 1 : 0.25} />
        ))}
      </g>
      <circle className="pi-dot" cx="7" cy="7" r="4.5" fill="currentColor" />
    </svg>
  )
}

export function RoleBadge({ role }: { role: Pick<Role, 'name' | 'color'> | undefined }) {
  if (!role) return <span className="badge">No role</span>
  return (
    <span className="badge">
      <span className="dot" style={{ background: role.color ?? 'var(--text-faint)' }} />
      {role.name}
    </span>
  )
}

/** The instance mark: the uploaded logo, or the first letter of the name. */
export function BrandMark({ name, logoUrl, large }: { name: string; logoUrl: string | null; large?: boolean }) {
  return (
    <span className={large ? 'brand-mark brand-mark-lg' : 'brand-mark'} aria-hidden>
      {logoUrl ? <img src={logoUrl} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function LabelChip({ label }: { label: Pick<Label, 'name' | 'color'> }) {
  return (
    <span className="label-chip" style={{ ['--label' as string]: label.color }}>
      {label.name}
    </span>
  )
}

export function DueBadge({ due, done }: { due: string | null; done: boolean }) {
  const info = dueInfo(due, done)
  if (!info) return null
  return (
    <span className={`due due-${info.tone}`} title={info.title}>
      <CalendarClock size={12} /> {info.text}
    </span>
  )
}

export const roleOptions = (roles: Role[]) =>
  roles.map((r) => ({ value: r.id, label: r.name, icon: <span className="dot" style={{ background: r.color ?? 'var(--text-faint)' }} /> }))

export function Modal({ title, onClose, children, footer, width = 440 }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Two-step button: the first click arms it, the second one within 3 seconds confirms. */
export function ConfirmButton({ onConfirm, children, confirmText = 'Click again to confirm', className, disabled }: {
  onConfirm: () => void
  children: ReactNode
  confirmText?: string
  className?: string
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <button
      type="button"
      className={cx('btn', armed ? 'btn-danger' : 'btn-ghost', className)}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          window.clearTimeout(timer.current)
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
          timer.current = window.setTimeout(() => setArmed(false), 3000)
        }
      }}
    >
      {armed ? confirmText : children}
    </button>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {children && <div className="empty-text">{children}</div>}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
