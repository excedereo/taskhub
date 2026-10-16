import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Archive, Building2, ChartColumn, GripVertical, Hash, Inbox, Layers, LogOut, PanelLeftClose, PanelLeftOpen, Plus, ScrollText, Settings, Settings2, Shield, Users } from 'lucide-react'
import { api } from '../api.ts'
import type { Category } from '../types.ts'
import { moveItem, useDragSort } from './useDragSort.ts'
import { useToast } from './Toast.tsx'
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
  const [arranging, setArranging] = useState(false)

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
            {can('manage_categories') && !arranging && (
              <span className="nav-heading-actions">
                {active.length > 1 && (
                  <button className="icon-btn icon-btn-sm" onClick={() => setArranging(true)} aria-label="Reorder categories" title="Reorder categories">
                    <Settings2 size={14} />
                  </button>
                )}
                <button className="icon-btn icon-btn-sm" onClick={() => setCreating(true)} aria-label="New category" title="New category">
                  <Plus size={14} />
                </button>
              </span>
            )}
          </div>
          {arranging && !collapsed ? (
            <CategoryArrange categories={active} onDone={() => setArranging(false)} />
          ) : (
            active.map((c) => (
              <NavItem key={c.id} to={`/tasks/c/${c.id}`} icon={<Hash size={16} />} label={c.name} count={c.openCount} active={pathname === `/tasks/c/${c.id}`} collapsed={collapsed} />
            ))
          )}
          {active.length === 0 && !collapsed && <p className="nav-empty">No categories yet</p>}
        </div>

        {/* Admin pages only show up for people who can actually use them. */}
        {(can('manage_users') || can('manage_roles') || can('view_audit') || can('manage_settings') || can('manage_categories')) && (
          <div className="nav-group">
            <div className="nav-heading">
              <span>Team</span>
            </div>
            {can('manage_users') && <NavItem to="/users" icon={<Users size={16} />} label="Users" active={pathname === '/users'} collapsed={collapsed} />}
            {can('manage_roles') && <NavItem to="/roles" icon={<Shield size={16} />} label="Roles" active={pathname === '/roles'} collapsed={collapsed} />}
            {can('view_audit') && <NavItem to="/audit" icon={<ScrollText size={16} />} label="Audit log" active={pathname === '/audit'} collapsed={collapsed} />}
            {(can('manage_settings') || can('manage_categories')) && <NavItem to="/workspace" icon={<Building2 size={16} />} label="Workspace settings" active={pathname === '/workspace'} collapsed={collapsed} />}
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
        <Link to="/settings" className={cx('icon-btn sign-out', pathname === '/settings' && 'active')} aria-label="Settings" title="Settings">
          <Settings size={16} />
        </Link>
        <button className="icon-btn sign-out" onClick={() => signOut().then(() => navigate('/login'))} aria-label="Sign out" title="Sign out">
          <LogOut size={16} />
        </button>
      </div>

      {creating && <CategoryModal onClose={() => setCreating(false)} />}
    </aside>
  )
}

/** Drag categories into a new order right in the sidebar; saved for everyone in one request. */
function CategoryArrange({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const { reloadCategories } = useData()
  const toast = useToast()
  const [order, setOrder] = useState(categories)
  const [busy, setBusy] = useState(false)
  const sort = useDragSort(order.length, (from, to) => setOrder((o) => moveItem(o, from, to)))

  const save = async () => {
    setBusy(true)
    try {
      await api.put('/categories/order', { ids: order.map((c) => c.id) })
      await reloadCategories()
      onDone()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nav-arrange">
      <ul>
        {order.map((c, i) => (
          <li key={c.id} ref={sort.ref(i)} style={sort.style(i)} className={cx('nav-arrange-item', sort.dragging === i && 'is-dragging')}>
            <button type="button" className="grip" aria-label={`Drag ${c.name}`} title="Drag to reorder (or focus and use the arrow keys)" {...sort.handle(i)}>
              <GripVertical size={14} />
            </button>
            <span className="truncate">{c.name}</span>
          </li>
        ))}
      </ul>
      <div className="nav-arrange-actions">
        <button className="btn btn-sm btn-ghost" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={busy}>
          Save
        </button>
      </div>
    </div>
  )
}
