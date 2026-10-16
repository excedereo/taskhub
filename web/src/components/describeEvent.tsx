import type { ReactNode } from 'react'
import type { AuditEvent, Category, PermissionInfo, Priority, Role, Status, User } from '../types.ts'
import { priorityLabel, statusLabel } from '../types.ts'
import { displayName } from '../util.ts'

export type EventContext = {
  userById: Map<number, User>
  roleById: Map<number, Role>
  categoryById: Map<number, Category>
  permissions: PermissionInfo[]
}

type Changes = Record<string, [unknown, unknown]>

const B = ({ children }: { children: ReactNode }) => <strong>{children}</strong>

function joinParts(parts: ReactNode[]) {
  return parts.flatMap((p, i) => (i === 0 ? [p] : [i === parts.length - 1 ? ' and ' : ', ', p]))
}

/**
 * Turns an audit entry into a human sentence without the actor, e.g. "moved #4 Login crash to Done".
 * Inside a task's own history the task reference is dropped, since it is obvious from context.
 */
export function describeEvent(e: AuditEvent, ctx: EventContext, inTask = false): ReactNode {
  const d = e.data
  const changes = (d.changes ?? {}) as Changes
  const user = (id: unknown) => <B>{typeof id === 'number' ? displayName(ctx.userById.get(id)) : 'nobody'}</B>
  const role = (id: unknown) => <B>{ctx.roleById.get(id as number)?.name ?? 'a deleted role'}</B>
  const category = (id: unknown) => <B>{ctx.categoryById.get(id as number)?.name ?? 'a deleted category'}</B>
  const perm = (key: string) => ctx.permissions.find((p) => p.key === key)?.label ?? key
  const name = <B>{String(d.name ?? '')}</B>
  const task = inTask ? null : (
    <>
      {' '}
      <B>
        #{e.entityId} {String(d.title ?? '')}
      </B>
    </>
  )

  switch (e.action) {
    case 'user.bootstrap':
      return 'set up this instance and became the owner'
    case 'user.joined':
      return 'joined the team'
    case 'user.activated':
      return 'signed in for the first time'
    case 'user.invited':
      return <>added Discord user {name} as {role(d.roleId)}</>
    case 'user.removed':
      return <>removed the invitation for {name}</>
    case 'user.updated': {
      const parts: ReactNode[] = []
      if (changes.role_id) parts.push(<>changed the role of {name} from {role(changes.role_id[0])} to {role(changes.role_id[1])}</>)
      if (changes.status) parts.push(changes.status[1] === 'disabled' ? <>disabled {name}</> : <>re-enabled {name}</>)
      return joinParts(parts)
    }

    case 'role.created':
      return <>created the role {name}</>
    case 'role.deleted':
      return <>deleted the role {name}{d.movedUsers ? `, moving ${d.movedUsers} member(s) to the default role` : ''}</>
    case 'role.updated': {
      const parts: ReactNode[] = []
      if (changes.name) parts.push(<>renamed the role <B>{String(changes.name[0])}</B> to {name}</>)
      if (changes.color) parts.push(<>changed the color of {name}</>)
      if (changes.permissions) {
        const [before, after] = changes.permissions as [string[], string[]]
        const added = after.filter((p) => !before.includes(p)).map(perm)
        const removed = before.filter((p) => !after.includes(p)).map(perm)
        const detail = [added.length && `granted ${added.join(', ')}`, removed.length && `revoked ${removed.join(', ')}`].filter(Boolean).join('; ')
        parts.push(<>updated permissions of {name}{detail ? `: ${detail}` : ''}</>)
      }
      return joinParts(parts)
    }

    case 'category.created':
      return <>created the category {name}</>
    case 'category.deleted':
      return <>deleted the category {name}</>
    case 'category.updated': {
      const parts: ReactNode[] = []
      if (changes.name) parts.push(<>renamed the category <B>{String(changes.name[0])}</B> to {name}</>)
      if (changes.description) parts.push(<>edited the description of {name}</>)
      if (changes.archived) parts.push(changes.archived[1] ? <>archived {name}</> : <>restored {name} from the archive</>)
      return joinParts(parts)
    }

    case 'task.created':
      return <>created{task || ' this task'}{!inTask && <> in {category(d.categoryId)}</>}</>
    case 'task.deleted':
      return <>deleted{task} from {category(d.categoryId)}</>
    case 'task.taken':
      return <>took{task || ' this task'}</>
    case 'task.assigned':
      return <>assigned{task || ' this task'} to {user(changes.assignee_id?.[1])}</>
    case 'task.unassigned':
      return <>unassigned {user(changes.assignee_id?.[0])} from{task || ' this task'}</>
    case 'task.updated': {
      const parts: ReactNode[] = []
      if (changes.status) parts.push(<>moved{task} from <B>{statusLabel(changes.status[0] as Status)}</B> to <B>{statusLabel(changes.status[1] as Status)}</B></>)
      if (changes.priority) parts.push(<>set priority{inTask ? '' : <> of{task}</>} to <B>{priorityLabel(changes.priority[1] as Priority)}</B></>)
      if (changes.title) parts.push(<>renamed{inTask ? ' the task' : <> <B>#{e.entityId} {String(changes.title[0])}</B></>} to <B>{String(changes.title[1])}</B></>)
      if (changes.description) parts.push(<>edited the description{inTask ? '' : <> of{task}</>}</>)
      if (changes.category_id) parts.push(<>moved{task || ' this task'} to {category(changes.category_id[1])}</>)
      return joinParts(parts)
    }

    case 'settings.updated': {
      const labels: Record<string, string> = { instanceName: 'instance name', registration: 'registration mode', defaultRoleId: 'default role' }
      return <>changed {Object.keys(changes).map((k) => labels[k] ?? k).join(', ')}</>
    }

    default:
      return e.action
  }
}
