/** What a status means for the workflow; all logic looks at this, never at the name. */
export type StatusType = 'todo' | 'active' | 'done'

export type Status = {
  id: number
  name: string
  color: string
  icon: string | null
  type: StatusType
  position: number
  taskCount: number
}

export type PermissionInfo = { key: string; label: string; description: string }

export type Meta = {
  instanceName: string
  discordConfigured: boolean
  devLogin: boolean
  needsSetup: boolean
  logoUrl: string | null
  permissions: PermissionInfo[]
  version: string
  commit: string | null
  repoUrl: string
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
  /** Categories this user can see; null means all of them. */
  viewCategoryIds: number[] | null
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
  joinedAt: number | null
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
  viewCategories: number[] | null
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
  position: number
  folderId: number | null
}

export type CategoryFolder = { id: number; name: string; position: number }

export type Task = {
  id: number
  categoryId: number
  title: string
  description: string
  statusId: number
  priorityId: number
  creatorId: number | null
  assigneeId: number | null
  createdAt: number
  updatedAt: number
  closedAt: number | null
  attachmentCount: number
  archivedAt: number | null
  /** Calendar day YYYY-MM-DD; the deadline is the end of that day. */
  dueDate: string | null
  labelIds: number[]
  parentId: number | null
  position: number
  subtaskCount: number
  subtaskDone: number
}

/** Workspace priorities, most important first. */
export type Priority = {
  id: number
  name: string
  color: string
  icon: string | null
  position: number
  isDefault: boolean
  taskCount: number
}

export type Label = {
  id: number
  name: string
  color: string
  taskCount: number
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


export type Webhook = {
  id: number
  name: string
  url: string
  events: string[] | null
  categories: number[] | null
  enabled: boolean
  lastError: string | null
  lastSentAt: number | null
  queued: number
  createdAt: number
}

export type EventGroup = { label: string; kinds: { key: string; label: string }[] }

export type ApiToken = {
  id: number
  name: string
  hint: string
  readOnly: boolean
  marked: boolean
  expiresAt: number | null
  lastUsedAt: number | null
  createdAt: number
}
