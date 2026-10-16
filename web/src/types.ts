export type Status = 'open' | 'in_progress' | 'review' | 'done'
export type Priority = 'low' | 'medium' | 'high'

export type PermissionInfo = { key: string; label: string; description: string }

export type Meta = {
  instanceName: string
  discordConfigured: boolean
  devLogin: boolean
  needsSetup: boolean
  permissions: PermissionInfo[]
}

export type Me = {
  id: number
  discordId: string
  username: string | null
  displayName: string | null
  avatar: string | null
  roleId: number
  roleName: string
  roleColor: string | null
  permissions: string[]
  /** Categories this user may create tasks in; null means all of them. */
  createCategoryIds: number[] | null
}

export type User = {
  id: number
  discordId: string
  username: string | null
  displayName: string | null
  avatar: string | null
  roleId: number
  status: 'invited' | 'active' | 'disabled'
  createdAt: number
  lastLoginAt: number | null
}

export type Role = {
  id: number
  name: string
  color: string | null
  permissions: string[]
  isSystem: boolean
  isDefault: boolean
  memberCount: number
  createCategories: number[] | null
}

export type Category = {
  id: number
  name: string
  description: string
  archived: boolean
  createdBy: number | null
  createdAt: number
  openCount: number
  /** Finished top-level tasks that are not archived yet. */
  doneCount: number
  totalCount: number
}

export type Task = {
  id: number
  categoryId: number
  title: string
  description: string
  status: Status
  priority: Priority
  creatorId: number | null
  assigneeId: number | null
  createdAt: number
  updatedAt: number
  closedAt: number | null
  attachmentCount: number
  archivedAt: number | null
  parentId: number | null
  position: number
  subtaskCount: number
  subtaskDone: number
}

export type Section = {
  id: number
  categoryId: number
  title: string
  position: number
}

export type Attachment = {
  id: number
  taskId: number
  uploaderId: number | null
  name: string
  mime: string
  size: number
  width: number | null
  height: number | null
  createdAt: number
  url: string
}

export type AuditEvent = {
  id: number
  actorId: number | null
  entityType: 'user' | 'role' | 'category' | 'task' | 'settings'
  entityId: number | null
  action: string
  data: Record<string, unknown>
  createdAt: number
}

export type Settings = {
  instanceName: string
  registration: 'invite' | 'open'
  defaultRoleId: number
}

export const STATUSES: { key: Status; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'review', label: 'In review' },
  { key: 'done', label: 'Done' },
]

export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
]

export const statusLabel = (s: Status) => STATUSES.find((x) => x.key === s)?.label ?? s
export const priorityLabel = (p: Priority) => PRIORITIES.find((x) => x.key === p)?.label ?? p
