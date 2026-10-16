import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useSession } from '../store.tsx'
import { cx } from '../util.ts'
import { api } from '../api.ts'
import { syncWorkspaceThemes, type WorkspaceTheme } from '../prefs.ts'
import { Sidebar } from './Sidebar.tsx'
import { MENU_EVENT, TourPrompt, TourProvider } from '../tour/Tour.tsx'

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

  // The tour opens the menu on phones when it points at something inside it.
  useEffect(() => {
    const onMenu = (e: Event) => setMobileOpen(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener(MENU_EVENT, onMenu)
    return () => window.removeEventListener(MENU_EVENT, onMenu)
  }, [])

  // Picks up edits to the chosen workspace theme made by someone else since the last visit.
  const signedIn = Boolean(me)
  useEffect(() => {
    if (signedIn) api.get<WorkspaceTheme[]>('/themes').then(syncWorkspaceThemes).catch(() => {})
  }, [signedIn])

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
    <TourProvider>
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
        <TourPrompt />
      </div>
    </TourProvider>
  )
}
