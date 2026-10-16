import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { api } from '../api.ts'
import { useData, useMe, useSession } from '../store.tsx'
import type { Task } from '../types.ts'
import { displayName, timeAgo } from '../util.ts'
import { Avatar, PageHeader, PriorityIcon, RoleBadge, StatusIcon } from '../components/ui.tsx'
import { useToast } from '../components/Toast.tsx'
import { ApiTokens } from '../components/ApiTokens.tsx'

export function ProfilePage() {
  const me = useMe()
  const { meta, signOut } = useSession()
  const { roleById, categoryById, statuses, isDone, can } = useData()
  const toast = useToast()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    api.get<Task[]>('/tasks?assignee=me').then(setTasks).catch(toast.error)
  }, [toast])

  const active = tasks.filter((t) => !isDone(t))
  const stats = statuses.map((s) => ({ label: s.name, value: tasks.filter((t) => t.statusId === s.id).length }))
  const isAdmin = me.permissions.includes('admin')
  // Administrator already means "everything", listing the rest would just repeat it.
  const perms = meta?.permissions.filter((p) => (isAdmin ? p.key === 'admin' : me.permissions.includes(p.key))) ?? []

  return (
    <div className="page page-narrow">
      <PageHeader title="Profile" />

      <div className="card profile-card">
        <Avatar user={me} size={64} />
        <div className="stack grow min-w-0">
          <span className="profile-name truncate">{displayName(me)}</span>
          <span className="muted small mono truncate">
            {me.username ? `@${me.username} · ` : ''}
            {me.discordId}
          </span>
          <span className="profile-role">
            <RoleBadge role={roleById.get(me.roleId) ?? { name: me.roleName, color: me.roleColor }} />
          </span>
        </div>
        <button className="btn btn-ghost" onClick={() => signOut().then(() => navigate('/login'))}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
      <p className="muted small">Your name and avatar come from Discord and update every time you sign in.</p>

      <div className="stats">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <span className="stat-value">{s.value}</span>
            <span className="muted small">{s.label}</span>
          </div>
        ))}
      </div>

      <section className="section">
        <h2 className="section-title">Working on</h2>
        {active.length === 0 ? (
          <p className="muted">Nothing assigned right now.</p>
        ) : (
          <ul className="task-list card-list">
            {active.map((t) => (
              <li key={t.id}>
                <Link className="task-row" to={`/tasks?assignee=me&task=${t.id}`}>
                  <PriorityIcon id={t.priorityId} />
                  <span className="task-id">#{t.id}</span>
                  <StatusIcon id={t.statusId} />
                  <span className="task-title truncate">{t.title}</span>
                  <span className="badge task-category">{categoryById.get(t.categoryId)?.name}</span>
                  <span className="task-time muted small">{timeAgo(t.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2 className="section-title">What you can do</h2>
        <ul className="perm-summary">
          {perms.map((p) => (
            <li key={p.key}>
              <span>{p.label}</span>
              <span className="muted small">
                {p.key === 'create_tasks' && me.createCategoryIds !== null
                  ? `Only in: ${me.createCategoryIds.map((id) => categoryById.get(id)?.name).filter(Boolean).join(', ') || 'no category yet'}`
                  : p.description}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {can('use_api') && <ApiTokens />}
    </div>
  )
}
