import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Archive, Building2, ChartColumn, ChevronRight, Folder, FolderOpen, FolderPlus, GripVertical, Hash, Inbox, Layers, LogOut, PanelLeftClose, PanelLeftOpen, Plus, ScrollText, Settings, Settings2, Shield, Users, Webhook, X } from 'lucide-react'
import { api } from '../api.ts'
import type { Category, CategoryFolder } from '../types.ts'
import { moveItem, useDragSort } from './useDragSort.ts'
import { useToast } from './Toast.tsx'
import { useData, useMe, useSession } from '../store.tsx'
import { cx, displayName } from '../util.ts'
import { Avatar, BrandMark } from './ui.tsx'
import { CategoryModal } from './CategoryModal.tsx'

function NavItem({ to, icon, label, active, count, collapsed, tour, nested }: { to: string; icon: ReactNode; label: string; active: boolean; count?: number; collapsed: boolean; tour?: string; nested?: boolean }) {
  return (
    <Link data-tour={tour} to={to} className={cx('nav-item', active && 'active', nested && 'nav-item-nested')} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {!!count && <span className="nav-count">{count}</span>}
    </Link>
  )
}

type Top = { kind: 'category'; pos: number; category: Category } | { kind: 'folder'; pos: number; folder: CategoryFolder; categories: Category[] }

const byPosition = (a: { position: number; id: number }, b: { position: number; id: number }) => a.position - b.position || a.id - b.id

/** Loose categories and folders in one order; folders without anything this person can see are left out. */
function buildTree(categories: Category[], folders: CategoryFolder[]): Top[] {
  const known = new Set(folders.map((f) => f.id))
  const loose = categories.filter((c) => c.folderId === null || !known.has(c.folderId))
  return [
    ...loose.map((c): Top => ({ kind: 'category', pos: c.position, category: c })),
    ...folders
      .map((f): Top => ({ kind: 'folder', pos: f.position, folder: f, categories: categories.filter((c) => c.folderId === f.id).sort(byPosition) }))
      .filter((t) => t.kind === 'folder' && t.categories.length > 0),
  ].sort((a, b) => a.pos - b.pos)
}

const CLOSED_KEY = 'taskhub.folders.closed'

/** Which folders this person has folded, remembered in this browser. */
function useClosedFolders() {
  const [closed, setClosed] = useState<number[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : []
    } catch {
      return []
    }
  })
  const toggle = (id: number) =>
    setClosed((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next))
      } catch {
        // storage unavailable: the choice just won't be remembered
      }
      return next
    })
  return [closed, toggle] as const
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const me = useMe()
  const { meta, signOut } = useSession()
  const { categories, can } = useData()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [arranging, setArranging] = useState(false)
  const [folders, setFolders] = useState<CategoryFolder[]>([])
  const [closed, toggleFolder] = useClosedFolders()
  const loadFolders = useCallback(() => api.get<CategoryFolder[]>('/category-folders').then(setFolders).catch(() => {}), [])
  // Categories reload after every change (including a new layout), so folders follow along.
  useEffect(() => {
    loadFolders()
  }, [loadFolders, categories])

  const params = new URLSearchParams(search)
  const onTasks = pathname === '/tasks'
  const active = categories.filter((c) => !c.archived).sort(byPosition)
  const tree = buildTree(active, folders)
  // Folders are shared, so only someone who sees every category may rearrange them.
  const canArrange = can('manage_categories') && (me.permissions.includes('admin') || me.viewCategoryIds === null)
  const categoryItem = (c: Category, nested = false) => (
    <NavItem key={c.id} to={`/tasks/c/${c.id}`} icon={<Hash size={16} />} label={c.name} count={c.openCount} active={pathname === `/tasks/c/${c.id}`} collapsed={collapsed} nested={nested} />
  )

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link to="/tasks" className="brand" title={meta?.instanceName}>
          <BrandMark logoUrl={meta?.logoUrl ?? null} />
          <span className="brand-name">{meta?.instanceName}</span>
        </Link>
        <button className="icon-btn collapse-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="sidebar-scroll">
        <div className="nav-group">
          <NavItem to="/tasks?assignee=me" icon={<Inbox size={16} />} label="My tasks" tour="nav-my" active={onTasks && params.get('assignee') === 'me'} collapsed={collapsed} />
          <NavItem to="/tasks" icon={<Layers size={16} />} label="All tasks" tour="nav-all" active={onTasks && params.get('assignee') !== 'me'} collapsed={collapsed} />
          <NavItem to="/analytics" icon={<ChartColumn size={16} />} label="Analytics" tour="nav-analytics" active={pathname === '/analytics'} collapsed={collapsed} />
          <NavItem to="/archived" icon={<Archive size={16} />} label="Archived" tour="nav-archived" active={pathname === '/archived'} collapsed={collapsed} />
        </div>

        <div className="nav-group" data-tour="nav-categories">
          <div className="nav-heading">
            <span>Categories</span>
            {can('manage_categories') && !arranging && (
              <span className="nav-heading-actions">
                {canArrange && active.length > 0 && (
                  <button className="icon-btn icon-btn-sm" onClick={() => setArranging(true)} aria-label="Arrange categories and folders" title="Arrange categories and folders">
                    <Settings2 size={14} />
                  </button>
                )}
                <button className="icon-btn icon-btn-sm" data-tour="new-category" onClick={() => setCreating(true)} aria-label="New category" title="New category">
                  <Plus size={14} />
                </button>
              </span>
            )}
          </div>
          {arranging && !collapsed ? (
            <CategoryArrange tree={tree} onDone={() => (setArranging(false), loadFolders())} />
          ) : collapsed ? (
            // The narrow sidebar has no room for folder names: categories in their order.
            tree.flatMap((t) => (t.kind === 'category' ? [t.category] : t.categories)).map((c) => categoryItem(c))
          ) : (
            tree.map((t) => {
              if (t.kind === 'category') return categoryItem(t.category)
              const isClosed = closed.includes(t.folder.id)
              const holdsActive = t.categories.some((c) => pathname === `/tasks/c/${c.id}`)
              const open = t.categories.reduce((sum, c) => sum + c.openCount, 0)
              return (
                <div key={`f${t.folder.id}`} className={cx('nav-folder', isClosed && 'is-closed')}>
                  <button type="button" className={cx('nav-item nav-folder-head', isClosed && holdsActive && 'active')} onClick={() => toggleFolder(t.folder.id)} aria-expanded={!isClosed}>
                    <span className="nav-icon">{isClosed ? <Folder size={16} /> : <FolderOpen size={16} />}</span>
                    <span className="nav-label">{t.folder.name}</span>
                    {isClosed && open > 0 && <span className="nav-count">{open}</span>}
                    <ChevronRight size={14} className="nav-folder-chevron" />
                  </button>
                  {!isClosed && <div className="nav-folder-body">{t.categories.map((c) => categoryItem(c, true))}</div>}
                </div>
              )
            })
          )}
          {active.length === 0 && !collapsed && <p className="nav-empty">No categories yet</p>}
        </div>

        {/* Admin pages only show up for people who can actually use them. */}
        {(can('manage_users') || can('manage_roles') || can('view_audit') || can('manage_settings') || can('manage_categories') || can('manage_integrations')) && (
          <div className="nav-group" data-tour="nav-team">
            <div className="nav-heading">
              <span>Team</span>
            </div>
            {can('manage_users') && <NavItem to="/users" icon={<Users size={16} />} label="Users" tour="nav-users" active={pathname === '/users'} collapsed={collapsed} />}
            {can('manage_roles') && <NavItem to="/roles" icon={<Shield size={16} />} label="Roles" tour="nav-roles" active={pathname === '/roles'} collapsed={collapsed} />}
            {can('view_audit') && <NavItem to="/audit" icon={<ScrollText size={16} />} label="Audit log" tour="nav-audit" active={pathname === '/audit'} collapsed={collapsed} />}
            {(can('manage_settings') || can('manage_categories')) && <NavItem to="/workspace" icon={<Building2 size={16} />} label="Workspace settings" tour="nav-workspace" active={pathname === '/workspace'} collapsed={collapsed} />}
            {can('manage_integrations') && <NavItem to="/integrations" icon={<Webhook size={16} />} label="Integrations" tour="nav-integrations" active={pathname === '/integrations'} collapsed={collapsed} />}
          </div>
        )}
      </nav>

      <div className="sidebar-foot">
        <Link data-tour="nav-profile" to="/profile" className={cx('profile-link', pathname === '/profile' && 'active')} title={collapsed ? displayName(me) : undefined}>
          <Avatar user={me} size={28} />
          <span className="profile-text">
            <span className="truncate">{displayName(me)}</span>
            <span className="muted small truncate">{me.roleName}</span>
          </span>
        </Link>
        <Link data-tour="nav-settings" to="/settings" className={cx('icon-btn sign-out', pathname === '/settings' && 'active')} aria-label="Settings" title="Settings">
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

type Row = { kind: 'folder'; key: string; id?: number; name: string } | { kind: 'category'; key: string; id: number; name: string }

let folderSeq = 0

/**
 * Arrange the sidebar in place: drag rows by the handle. A folder row takes every category below it,
 * up to the next folder, so the list reads the same way it will look. Loose categories go on top.
 */
function CategoryArrange({ tree, onDone }: { tree: Top[]; onDone: () => void }) {
  const { reloadCategories } = useData()
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>(() => [
    ...tree.filter((t) => t.kind === 'category').map((t): Row => ({ kind: 'category', key: `c${t.category.id}`, id: t.category.id, name: t.category.name })),
    ...tree.flatMap((t): Row[] =>
      t.kind === 'folder'
        ? [{ kind: 'folder', key: `f${t.folder.id}`, id: t.folder.id, name: t.folder.name }, ...t.categories.map((c): Row => ({ kind: 'category', key: `c${c.id}`, id: c.id, name: c.name }))]
        : [],
    ),
  ])
  const [busy, setBusy] = useState(false)
  const sort = useDragSort(rows.length, (from, to) => setRows((r) => moveItem(r, from, to)))

  const addFolder = () => setRows((r) => [...r, { kind: 'folder', key: `n${++folderSeq}`, name: 'New folder' }])
  const rename = (key: string, name: string) => setRows((r) => r.map((x) => (x.key === key && x.kind === 'folder' ? { ...x, name } : x)))
  // Removing a folder keeps its categories: they move up to the loose ones.
  const removeFolder = (index: number) =>
    setRows((r) => {
      let end = index + 1
      while (end < r.length && r[end].kind === 'category') end++
      const members = r.slice(index + 1, end)
      const rest = [...r.slice(0, index), ...r.slice(end)]
      const firstFolder = rest.findIndex((x) => x.kind === 'folder')
      const at = firstFolder < 0 ? rest.length : firstFolder
      return [...rest.slice(0, at), ...members, ...rest.slice(at)]
    })

  const save = async () => {
    setBusy(true)
    try {
      const items = rows.map((r) => (r.kind === 'folder' ? { type: 'folder', id: r.id, name: r.name.trim() || 'Folder' } : { type: 'category', id: r.id }))
      await api.put('/categories/layout', { items })
      await reloadCategories()
      onDone()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  // Categories under a folder are indented, so the grouping is visible while dragging.
  let inFolder = false
  return (
    <div className="nav-arrange">
      <ul>
        {rows.map((r, i) => {
          if (r.kind === 'folder') inFolder = true
          const nested = r.kind === 'category' && inFolder
          return (
            <li key={r.key} ref={sort.ref(i)} style={sort.style(i)} className={cx('nav-arrange-item', r.kind === 'folder' && 'nav-arrange-folder', nested && 'nav-arrange-nested', sort.dragging === i && 'is-dragging')}>
              <button type="button" className="grip" aria-label={`Drag ${r.name}`} title="Drag to reorder (or focus and use the arrow keys)" {...sort.handle(i)}>
                <GripVertical size={14} />
              </button>
              {r.kind === 'folder' ? (
                <>
                  <Folder size={14} className="muted" />
                  <input className="nav-arrange-name" value={r.name} maxLength={48} autoFocus={r.id === undefined} onChange={(e) => rename(r.key, e.target.value)} aria-label="Folder name" />
                  <button type="button" className="icon-btn icon-btn-sm" onClick={() => removeFolder(i)} aria-label={`Remove the folder ${r.name}`} title="Remove the folder (its categories stay)">
                    <X size={12} />
                  </button>
                </>
              ) : (
                <span className="truncate">{r.name}</span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="nav-arrange-actions">
        <button className="btn btn-sm btn-ghost nav-arrange-add" onClick={addFolder} disabled={busy}>
          <FolderPlus size={14} /> Folder
        </button>
        <span className="grow" />
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
