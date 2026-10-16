import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Archive, ChartColumn, Hash, Inbox, Layers, LogOut, PanelLeftClose, PanelLeftOpen, Plus, ScrollText, Settings, Shield, Users } from 'lucide-react'
import { useData, useMe, useSession } from '../store.tsx'
import { cx, displayName } from '../util.ts'
import { Avatar, BrandMark } from './ui.tsx'
import { CategoryModal } from './CategoryModal.tsx'

function NavItem({ to, icon, label, active, count, collapsed }: { to: string; icon: ReactNode; label: string; active: boolean; count?: number; collapsed: boolean }) {
  return (
    <Link to={to} className={cx('nav-item', active && 'active')} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {!!count && <span className="nav-count">{count}</span>}
    </Link>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const me = useMe()
  const { meta, signOut } = useSession()
  const { categories, can } = useData()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  const params = new URLSearchParams(search)
  const onTasks = pathname === '/tasks'
  const active = categories.filter((c) => !c.archived)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link to="/tasks" className="brand" title={meta?.instanceName}>
          <BrandMark name={meta?.instanceName ?? 'T'} logoUrl={meta?.logoUrl ?? null} />
          <span className="brand-name">{meta?.instanceName}</span>
        </Link>
        <button className="icon-btn collapse-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="sidebar-scroll">
        <div className="nav-group">
          <NavItem to="/tasks?assignee=me" icon={<Inbox size={16} />} label="My tasks" active={onTasks && params.get('assignee') === 'me'} collapsed={collapsed} />
          <NavItem to="/tasks" icon={<Layers size={16} />} label="All tasks" active={onTasks && params.get('assignee') !== 'me'} collapsed={collapsed} />
          <NavItem to="/analytics" icon={<ChartColumn size={16} />} label="Analytics" active={pathname === '/analytics'} collapsed={collapsed} />
          <NavItem to="/archived" icon={<Archive size={16} />} label="Archived" active={pathname === '/archived'} collapsed={collapsed} />
        </div>

        <div className="nav-group">
          <div className="nav-heading">
            <span>Categories</span>
            {can('manage_categories') && (
              <button className="icon-btn icon-btn-sm" onClick={() => setCreating(true)} aria-label="New category" title="New category">
                <Plus size={14} />
              </button>
            )}
          </div>
          {active.map((c) => (
            <NavItem key={c.id} to={`/tasks/c/${c.id}`} icon={<Hash size={16} />} label={c.name} count={c.openCount} active={pathname === `/tasks/c/${c.id}`} collapsed={collapsed} />
          ))}
          {active.length === 0 && !collapsed && <p className="nav-empty">No categories yet</p>}
        </div>

        {/* Admin pages only show up for people who can actually use them. */}
        {(can('manage_users') || can('manage_roles') || can('view_audit') || can('manage_settings')) && (
          <div className="nav-group">
            <div className="nav-heading">
              <span>Team</span>
            </div>
            {can('manage_users') && <NavItem to="/users" icon={<Users size={16} />} label="Users" active={pathname === '/users'} collapsed={collapsed} />}
            {can('manage_roles') && <NavItem to="/roles" icon={<Shield size={16} />} label="Roles" active={pathname === '/roles'} collapsed={collapsed} />}
            {can('view_audit') && <NavItem to="/audit" icon={<ScrollText size={16} />} label="Audit log" active={pathname === '/audit'} collapsed={collapsed} />}
            {can('manage_settings') && <NavItem to="/settings" icon={<Settings size={16} />} label="Settings" active={pathname === '/settings'} collapsed={collapsed} />}
          </div>
        )}
      </nav>

      <div className="sidebar-foot">
        <Link to="/profile" className={cx('profile-link', pathname === '/profile' && 'active')} title={collapsed ? displayName(me) : undefined}>
          <Avatar user={me} size={28} />
          <span className="profile-text">
            <span className="truncate">{displayName(me)}</span>
            <span className="muted small truncate">{me.roleName}</span>
          </span>
        </Link>
        <button className="icon-btn sign-out" onClick={() => signOut().then(() => navigate('/login'))} aria-label="Sign out" title="Sign out">
          <LogOut size={16} />
        </button>
      </div>

      {creating && <CategoryModal onClose={() => setCreating(false)} />}
    </aside>
  )
}
