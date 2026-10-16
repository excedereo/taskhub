import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useSession } from '../store.tsx'
import { cx } from '../util.ts'
import { Sidebar } from './Sidebar.tsx'

const COLLAPSED_KEY = 'taskhub.sidebar-collapsed'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function Layout() {
  const { me, meta } = useSession()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => setMobileOpen(false), [location.pathname, location.search])

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        // storage unavailable: the choice just won't persist
      }
      return !c
    })
  }

  if (me === undefined) return <div className="boot" />
  if (me === null) return <Navigate to="/login" replace />

  return (
    <div className={cx('app', collapsed && 'app-collapsed', mobileOpen && 'app-mobile-open')}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="scrim" onClick={() => setMobileOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <span className="topbar-title">{meta?.instanceName}</span>
        </header>
        <Outlet />
      </div>
    </div>
  )
}
