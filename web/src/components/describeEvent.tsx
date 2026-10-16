import type { ReactNode } from 'react'
import type { AuditEvent, Category, PermissionInfo, Priority, Role, Status, User } from '../types.ts'

// Entries written before statuses became editable store these keys.
const LEGACY_STATUS: Record<string, string> = { open: 'Open', in_progress: 'In progress', review: 'In review', done: 'Done' }

// Entries written before priorities became editable store these names.
const LEGACY_PRIORITY: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
import { displayName } from '../util.ts'

export type EventContext = {
  userById: Map<number, User>
  roleById: Map<number, Role>
  categoryById: Map<number, Category>
  priorityById?: Map<number, Priority>
  statusById?: Map<number, Status>
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
      if (changes.view_categories) {
        const limit = changes.view_categories[1] as number[] | null
        const names = (limit ?? []).map((id) => ctx.categoryById.get(id)?.name ?? 'a hidden category')
        parts.push(limit === null ? <>let {name} see every category</> : <>let {name} see only {names.length ? names.join(', ') : 'no category'}</>)
      }
      if (changes.create_categories) {
        const limit = changes.create_categories[1] as number[] | null
        const names = (limit ?? []).map((id) => ctx.categoryById.get(id)?.name ?? 'a deleted category')
        parts.push(limit === null ? <>let {name} create tasks in every category</> : <>limited {name} to creating tasks in {names.length ? names.join(', ') : 'no category'}</>)
      }
      if (changes.permissions) {
        const [before, after] = changes.permissions as [string[], string[]]
        const added = after.filter((p) => !before.includes(p)).map(perm)
        const removed = before.filter((p) => !after.includes(p)).map(perm)
        const detail = [added.length && `granted ${added.join(', ')}`, removed.length && `revoked ${removed.join(', ')}`].filter(Boolean).join('; ')
        parts.push(<>updated permissions of {name}{detail ? `: ${detail}` : ''}</>)
      }
      return joinParts(parts)
    }

    case 'label.created':
      return <>created the label {name}</>
    case 'label.updated':
      return <>edited the label {name}</>
    case 'label.deleted':
      return <>deleted the label {name}</>
    case 'priority.created':
      return <>added the priority {name}</>
    case 'priority.updated':
      return <>edited the priority {name}</>
    case 'priority.deleted':
      return <>deleted the priority {name}</>
    case 'priority.reordered':
      return 'reordered the priorities'
    case 'status.created':
      return <>added the status {name}</>
    case 'status.updated':
      return <>edited the status {name}</>
    case 'status.deleted':
      return <>deleted the status {name}</>
    case 'status.reordered':
      return 'reordered the statuses'
    case 'category.reordered':
      return 'reordered the categories'
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
      if (d.parentId) return <>created{inTask ? ' this subtask' : <> subtask{task}</>}</>
      return <>created{task || ' this task'}{!inTask && <> in {category(d.categoryId)}</>}</>
    case 'task.subtask_added':
      return <>added subtask <B>#{String(d.subtaskId)} {String(d.subtaskTitle ?? '')}</B>{task && <> to{task}</>}</>
    case 'task.deleted':
      return <>deleted{task} from {category(d.categoryId)}{Number(d.subtasks) > 0 && ` together with ${d.subtasks} subtask(s)`}</>
    case 'category.arranged': {
      const added = (d.added ?? []) as string[]
      const removed = (d.removed ?? []) as string[]
      const renamed = (d.renamed ?? []) as [string, string][]
      const details = [
        added.length && `added ${added.map((s) => `“${s}”`).join(', ')}`,
        removed.length && `removed ${removed.map((s) => `“${s}”`).join(', ')}`,
        renamed.length && `renamed ${renamed.map(([a, b]) => `“${a}” to “${b}”`).join(', ')}`,
      ].filter(Boolean)
      return <>rearranged {name}{details.length ? `: ${details.join('; ')}` : ''}</>
    }
    case 'task.taken':
      return <>took{task || ' this task'}</>
    case 'task.assigned':
      return <>assigned{task || ' this task'} to {user(changes.assignee_id?.[1])}</>
    case 'task.unassigned':
      return <>unassigned {user(changes.assignee_id?.[0])} from{task || ' this task'}</>
    case 'task.archived':
      return <>archived{task || ' this task'}</>
    case 'task.unarchived':
      return <>restored{task || ' this task'} from the archive</>
    case 'category.archived_done':
      return <>archived {String(d.count)} finished task(s) in {name}</>
    case 'task.attachment_added':
      return <>attached {name}{task && <> to{task}</>}</>
    case 'task.attachment_removed':
      return <>removed the image {name}{task && <> from{task}</>}</>
    case 'task.updated': {
      const parts: ReactNode[] = []
      const statusName = (v: unknown) => (typeof v === 'number' ? ctx.statusById?.get(v)?.name ?? 'a deleted status' : LEGACY_STATUS[String(v)] ?? String(v))
      if (changes.status) parts.push(<>moved{task} from <B>{statusName(changes.status[0])}</B> to <B>{statusName(changes.status[1])}</B></>)
      if (changes.status_id) parts.push(<>moved{task} from <B>{statusName(changes.status_id[0])}</B> to <B>{statusName(changes.status_id[1])}</B></>)
      if (changes.priority) parts.push(<>set priority{inTask ? '' : <> of{task}</>} to <B>{LEGACY_PRIORITY[String(changes.priority[1])] ?? String(changes.priority[1])}</B></>)
      if (changes.priority_id) parts.push(<>set priority{inTask ? '' : <> of{task}</>} to <B>{ctx.priorityById?.get(changes.priority_id[1] as number)?.name ?? 'a deleted priority'}</B></>)
      if (changes.title) parts.push(<>renamed{inTask ? ' the task' : <> <B>#{e.entityId} {String(changes.title[0])}</B></>} to <B>{String(changes.title[1])}</B></>)
      if (changes.description) parts.push(<>edited the description{inTask ? '' : <> of{task}</>}</>)
      if (changes.due_date) {
        const due = changes.due_date[1] as string | null
        parts.push(due ? <>set the due date{inTask ? '' : <> of{task}</>} to <B>{due}</B></> : <>removed the due date{inTask ? '' : <> of{task}</>}</>)
      }
      if (changes.labels) parts.push(<>changed labels{inTask ? '' : <> of{task}</>}</>)
      if (changes.category_id) parts.push(<>moved{task || ' this task'} to {category(changes.category_id[1])}</>)
      return joinParts(parts)
    }

    case 'settings.updated': {
      if (changes.logo) return changes.logo[1] ? 'uploaded a new logo' : 'removed the logo'
      const labels: Record<string, string> = { instanceName: 'instance name', registration: 'registration mode', defaultRoleId: 'default role' }
      return <>changed {Object.keys(changes).map((k) => labels[k] ?? k).join(', ')}</>
    }

    default:
      return e.action
  }
}
