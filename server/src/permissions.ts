export const PERMISSIONS = [
  { key: 'admin', label: 'Administrator', description: 'Every permission, including ones added later. Cannot be restricted.' },
  { key: 'manage_settings', label: 'Manage settings', description: 'Change instance name, registration mode and default role.' },
  { key: 'manage_users', label: 'Manage users', description: 'Add users by Discord ID, change their roles, disable accounts.' },
  { key: 'manage_roles', label: 'Manage roles', description: 'Create and edit roles. Can only grant permissions they have themselves.' },
  { key: 'manage_categories', label: 'Manage categories and labels', description: 'Create, rename, archive and delete categories, and manage labels.' },
  { key: 'create_tasks', label: 'Create tasks', description: 'Open new tasks. Can be limited to certain categories.' },
  { key: 'edit_tasks', label: 'Edit any task', description: 'Edit and move tasks created by others. Authors can always edit their own.' },
  { key: 'delete_tasks', label: 'Delete any task', description: 'Permanently delete any task. The deletion stays in the audit log.' },
  { key: 'delete_own_tasks', label: 'Delete own tasks', description: 'Delete tasks they created themselves.' },
  { key: 'assign_tasks', label: 'Assign tasks', description: 'Assign tasks to anyone or take them away.' },
  { key: 'take_tasks', label: 'Take tasks', description: 'Pick up unassigned tasks for themselves.' },
  { key: 'view_audit', label: 'View audit log', description: 'See the full history of changes across the instance.' },
  { key: 'manage_themes', label: 'Manage themes', description: 'Create workspace themes anyone can pick, including custom CSS. Treat it as close to admin.' },
  { key: 'use_api', label: 'Use the API and AI agents', description: "Create personal API tokens, so scripts and AI agents can act with this role's permissions." },
  { key: 'manage_integrations', label: 'Manage integrations', description: 'Connect Discord webhooks and choose which events they post.' },
] as const

export type Permission = (typeof PERMISSIONS)[number]['key']

const keys = new Set<string>(PERMISSIONS.map((p) => p.key))

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && keys.has(value)
}

export function hasPermission(granted: readonly string[], perm: Permission) {
  return granted.includes('admin') || granted.includes(perm)
}

/** Whether a user may create tasks in this category: the permission plus the role's category limit. */
export function canCreateIn(granted: readonly string[], limit: readonly number[] | null, categoryId: number) {
  if (granted.includes('admin')) return true
  return granted.includes('create_tasks') && (limit === null || limit.includes(categoryId))
}

/** A category limit is "within" another when it allows no category the other does not. */
export function limitWithin(requested: readonly number[] | null, actor: readonly number[] | null) {
  if (actor === null) return true
  if (requested === null) return false
  return requested.every((id) => actor.includes(id))
}

/** True when `granted` covers every permission in `requested`. */
export function covers(granted: readonly string[], requested: readonly string[]) {
  return granted.includes('admin') || requested.every((p) => granted.includes(p))
}
