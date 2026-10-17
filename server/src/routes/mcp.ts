/**
 * A small MCP server (Model Context Protocol, Streamable HTTP, plain JSON responses), so AI agents
 * like Claude Code can use Taskhub as a set of tools. Every tool calls the regular REST API with the
 * caller's own credentials, so permissions, category limits and the audit log work exactly as on the site.
 */
import { Router, type Request } from 'express'
import { config } from '../config.ts'
import { INTERNAL_SECRET } from '../auth.ts'
import { me } from '../http.ts'

export const mcpRouter = Router()

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

type Json = Record<string, unknown>
type Named = { id: number; name: string }
type ApiUser = { id: number; displayName: string | null; username: string | null; discordId: string; roleId: number; status: string }
type ApiStatus = Named & { type: 'todo' | 'active' | 'done' }
type ApiPriority = Named & { isDefault: boolean }
type ApiCategory = Named & { archived: boolean; description: string }
type ApiTask = {
  id: number
  title: string
  description: string
  categoryId: number
  parentId: number | null
  statusId: number
  priorityId: number
  assigneeId: number | null
  creatorId: number | null
  dueDate: string | null
  labelIds: number[]
  subtaskCount: number
  subtaskDone: number
  updatedAt: number
  closedAt: number | null
}

class ToolError extends Error {}

/** Calls our own API as the same person (same token or session cookie). */
async function call<T>(req: Request, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-taskhub-internal': INTERNAL_SECRET }
  const auth = req.get('authorization')
  if (auth) headers.authorization = auth
  const cookie = req.get('cookie')
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`http://127.0.0.1:${config.port}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new ToolError((data && data.error) || `Request failed with ${res.status}`)
  return data as T
}

/** Loads everything needed to turn ids into names and names into ids. */
async function workspace(req: Request) {
  const [categories, statuses, priorities, labels, users] = await Promise.all([
    call<ApiCategory[]>(req, 'GET', '/categories'),
    call<ApiStatus[]>(req, 'GET', '/statuses'),
    call<ApiPriority[]>(req, 'GET', '/priorities'),
    call<Named[]>(req, 'GET', '/labels'),
    call<ApiUser[]>(req, 'GET', '/users'),
  ])
  const userName = (u: ApiUser) => u.displayName || u.username || u.discordId
  return { categories, statuses, priorities, labels, users, userName }
}
type Workspace = Awaited<ReturnType<typeof workspace>>

/** Accepts an id or a name (case-insensitive, or an unambiguous start of one). */
function resolve<T extends { id: number }>(list: T[], value: unknown, kind: string, nameOf: (x: T) => string): T {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const found = list.find((x) => x.id === Number(value))
    if (found) return found
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/^@/, '')
    const exact = list.filter((x) => nameOf(x).toLowerCase() === v)
    if (exact.length === 1) return exact[0]
    const starts = list.filter((x) => nameOf(x).toLowerCase().startsWith(v))
    if (starts.length === 1) return starts[0]
  }
  throw new ToolError(`Unknown ${kind} "${value}". Options: ${list.map((x) => `${nameOf(x)} (${x.id})`).join(', ')}`)
}

const taskUrl = (t: { id: number; categoryId: number }) => `${config.publicUrl}/tasks/c/${t.categoryId}?task=${t.id}`

function brief(t: ApiTask, w: Workspace) {
  const assignee = w.users.find((u) => u.id === t.assigneeId)
  return {
    id: t.id,
    title: t.title,
    status: w.statuses.find((s) => s.id === t.statusId)?.name,
    priority: w.priorities.find((p) => p.id === t.priorityId)?.name,
    category: w.categories.find((c) => c.id === t.categoryId)?.name,
    assignee: assignee ? w.userName(assignee) : null,
    due: t.dueDate,
    labels: t.labelIds.map((id) => w.labels.find((l) => l.id === id)?.name).filter(Boolean),
    parentId: t.parentId,
    subtasks: t.subtaskCount ? `${t.subtaskDone}/${t.subtaskCount} done` : undefined,
    url: taskUrl(t),
  }
}

type Tool = {
  name: string
  description: string
  write: boolean
  inputSchema: Json
  run: (req: Request, args: Json) => Promise<unknown>
}

const str = (description: string) => ({ type: 'string', description })
const idOrName = (description: string) => ({ type: ['string', 'number'], description })
const idArg = { type: 'number', description: 'Task id, the number after #' }

const TOOLS: Tool[] = [
  {
    name: 'get_workspace',
    description: 'Who you are and what exists: your role and permissions, categories, statuses (with their type), priorities, labels and people. Call this first; other tools accept these names or ids.',
    write: false,
    inputSchema: { type: 'object', properties: {} },
    run: async (req) => {
      const w = await workspace(req)
      const user = me(req)
      return {
        you: { id: user.id, name: user.displayName || user.username, role: user.roleName, permissions: user.permissions, via: req.apiToken?.name ?? null },
        categories: w.categories.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, description: c.description || undefined })),
        statuses: w.statuses.map((s) => ({ id: s.id, name: s.name, type: s.type })),
        priorities: w.priorities.map((p) => ({ id: p.id, name: p.name, default: p.isDefault || undefined })),
        labels: w.labels.map((l) => ({ id: l.id, name: l.name })),
        people: w.users.filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: w.userName(u), username: u.username })),
      }
    },
  },
  {
    name: 'list_tasks',
    description: 'Find tasks. Unfinished ones by default, most active first. Filters can be combined.',
    write: false,
    inputSchema: {
      type: 'object',
      properties: {
        category: idOrName('Category name or id'),
        status: idOrName('Status name or id. Setting it also includes finished tasks of that status.'),
        assignee: str('"me", "none", or a person\'s name or id'),
        label: idOrName('Label name or id'),
        search: str('Text in the title or description, or a task number like #42'),
        include_finished: { type: 'boolean', description: 'Also return finished (done) tasks' },
        limit: { type: 'number', description: 'At most this many tasks (default 50, max 200)' },
      },
    },
    run: async (req, a) => {
      const w = await workspace(req)
      const qs = new URLSearchParams()
      if (a.category !== undefined) qs.set('categoryId', String(resolve(w.categories, a.category, 'category', (c) => c.name).id))
      if (a.status !== undefined) qs.set('statusId', String(resolve(w.statuses, a.status, 'status', (s) => s.name).id))
      if (a.label !== undefined) qs.set('label', String(resolve(w.labels, a.label, 'label', (l) => l.name).id))
      if (a.assignee === 'me' || a.assignee === 'none') qs.set('assignee', a.assignee)
      else if (a.assignee !== undefined) qs.set('assignee', String(resolve(w.users, a.assignee, 'person', w.userName).id))
      if (typeof a.search === 'string' && a.search.trim()) qs.set('q', a.search.trim())
      let tasks = await call<ApiTask[]>(req, 'GET', `/tasks?${qs}`)
      const done = new Set(w.statuses.filter((s) => s.type === 'done').map((s) => s.id))
      if (!a.include_finished && a.status === undefined) tasks = tasks.filter((t) => !done.has(t.statusId))
      const limit = Math.min(Math.max(Number(a.limit) || 50, 1), 200)
      return { total: tasks.length, tasks: tasks.slice(0, limit).map((t) => brief(t, w)) }
    },
  },
  {
    name: 'get_task',
    description: 'One task in full: description, subtasks, parent and recent history.',
    write: false,
    inputSchema: { type: 'object', properties: { id: idArg }, required: ['id'] },
    run: async (req, a) => {
      const w = await workspace(req)
      const d = await call<{ task: ApiTask; subtasks: ApiTask[]; parent: { id: number; title: string } | null; history: { action: string; actorId: number | null; createdAt: number; data: Json }[] }>(req, 'GET', `/tasks/${Number(a.id)}`)
      const creator = w.users.find((u) => u.id === d.task.creatorId)
      return {
        ...brief(d.task, w),
        description: d.task.description,
        createdBy: creator ? w.userName(creator) : null,
        parent: d.parent,
        subtasks: d.subtasks.map((t) => brief(t, w)),
        history: d.history.slice(0, 15).map((h) => {
          const actor = w.users.find((u) => u.id === h.actorId)
          return { when: new Date(h.createdAt).toISOString(), who: actor ? w.userName(actor) : null, action: h.action, via: h.data.via }
        }),
      }
    },
  },
  {
    name: 'create_task',
    description: 'Create a task, or a subtask when parent_id is given (it then goes to the parent\'s category).',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: str('Short title'),
        category: idOrName('Category name or id (not needed for subtasks)'),
        description: str('Longer description, plain text'),
        priority: idOrName('Priority name or id; the workspace default if left out'),
        assignee: str('"me" or a person\'s name or id'),
        due_date: str('Due day as YYYY-MM-DD'),
        labels: { type: 'array', items: { type: ['string', 'number'] }, description: 'Label names or ids' },
        parent_id: { type: 'number', description: 'Make it a subtask of this task' },
      },
      required: ['title'],
    },
    run: async (req, a) => {
      const w = await workspace(req)
      const body: Json = { title: a.title, description: a.description ?? '' }
      if (a.parent_id !== undefined) body.parentId = Number(a.parent_id)
      else if (a.category !== undefined) body.categoryId = resolve(w.categories, a.category, 'category', (c) => c.name).id
      else throw new ToolError('Give a category, or a parent_id for a subtask')
      if (a.priority !== undefined) body.priorityId = resolve(w.priorities, a.priority, 'priority', (p) => p.name).id
      if (a.assignee !== undefined) body.assigneeId = a.assignee === 'me' ? me(req).id : resolve(w.users, a.assignee, 'person', w.userName).id
      if (a.due_date !== undefined) body.dueDate = a.due_date
      if (Array.isArray(a.labels)) body.labelIds = a.labels.map((l) => resolve(w.labels, l, 'label', (x) => x.name).id)
      return brief(await call<ApiTask>(req, 'POST', '/tasks', body), w)
    },
  },
  {
    name: 'update_task',
    description: 'Change a task: title, description, status, priority, category, due date or labels. Only the fields you pass change.',
    write: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: idArg,
        title: str('New title'),
        description: str('New description (replaces the old one)'),
        status: idOrName('Status name or id'),
        priority: idOrName('Priority name or id'),
        category: idOrName('Move to this category'),
        due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear' },
        labels: { type: 'array', items: { type: ['string', 'number'] }, description: 'The full new set of labels' },
      },
      required: ['id'],
    },
    run: async (req, a) => {
      const w = await workspace(req)
      const body: Json = {}
      if (a.title !== undefined) body.title = a.title
      if (a.description !== undefined) body.description = a.description
      if (a.status !== undefined) body.statusId = resolve(w.statuses, a.status, 'status', (s) => s.name).id
      if (a.priority !== undefined) body.priorityId = resolve(w.priorities, a.priority, 'priority', (p) => p.name).id
      if (a.category !== undefined) body.categoryId = resolve(w.categories, a.category, 'category', (c) => c.name).id
      if (a.due_date !== undefined) body.dueDate = a.due_date
      if (Array.isArray(a.labels)) body.labelIds = a.labels.map((l) => resolve(w.labels, l, 'label', (x) => x.name).id)
      if (!Object.keys(body).length) throw new ToolError('Nothing to change: pass at least one field')
      return brief(await call<ApiTask>(req, 'PATCH', `/tasks/${Number(a.id)}`, body), w)
    },
  },
  {
    name: 'take_task',
    description: 'Assign a task to yourself. Its status does not change; move it on with update_task when you start working.',
    write: true,
    inputSchema: { type: 'object', properties: { id: idArg }, required: ['id'] },
    run: async (req, a) => {
      const w = await workspace(req)
      return brief(await call<ApiTask>(req, 'POST', `/tasks/${Number(a.id)}/take`), w)
    },
  },
  {
    name: 'assign_task',
    description: 'Assign a task to someone, or pass null to leave it unassigned.',
    write: true,
    inputSchema: { type: 'object', properties: { id: idArg, assignee: { type: ['string', 'number', 'null'], description: '"me", a person\'s name or id, or null' } }, required: ['id', 'assignee'] },
    run: async (req, a) => {
      const w = await workspace(req)
      const userId = a.assignee === null ? null : a.assignee === 'me' ? me(req).id : resolve(w.users, a.assignee, 'person', w.userName).id
      return brief(await call<ApiTask>(req, 'POST', `/tasks/${Number(a.id)}/assign`, { userId }), w)
    },
  },
  {
    name: 'archive_task',
    description: 'Archive a task (hide it from lists without deleting it), or restore it with archived: false.',
    write: true,
    inputSchema: { type: 'object', properties: { id: idArg, archived: { type: 'boolean', description: 'false to restore; true by default' } }, required: ['id'] },
    run: async (req, a) => {
      const w = await workspace(req)
      return brief(await call<ApiTask>(req, 'POST', `/tasks/${Number(a.id)}/archive`, { archived: a.archived !== false }), w)
    },
  },
]

const toolsFor = (req: Request) => TOOLS.filter((t) => !(t.write && req.apiToken?.readOnly))

const INSTRUCTIONS = 'Taskhub is a task tracker. You act as the person who owns the token, with exactly their role\'s permissions. Start with get_workspace to learn the categories, statuses and people. Statuses have a type: todo (not started), active (in progress) and done (finished).'

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json }

async function handle(req: Request, msg: RpcMessage): Promise<Json | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } })
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request')
  // Notifications (no id) get no answer.
  const isNotification = msg.id === undefined

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'taskhub', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({
        tools: toolsFor(req).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: !t.write } })),
      })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const tool = toolsFor(req).find((t) => t.name === name)
      if (!tool) return fail(-32602, `Unknown tool: ${name}`)
      try {
        const result = await tool.run(req, (msg.params?.arguments as Json) ?? {})
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      } catch (err) {
        // Permission problems and bad input go back to the agent as a readable tool error.
        const message = err instanceof ToolError ? err.message : 'Internal error'
        if (!(err instanceof ToolError)) console.error('MCP tool failed:', err)
        return reply({ content: [{ type: 'text', text: message }], isError: true })
      }
    }
    default:
      if (isNotification) return null
      return fail(-32601, `Method not found: ${msg.method}`)
  }
}

mcpRouter.post('/mcp', async (req, res) => {
  const body: unknown = req.body
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(req, m as RpcMessage)))).filter(Boolean)
    if (!out.length) return res.status(202).end()
    return res.json(out)
  }
  const msg = body as RpcMessage
  if (msg && msg.id === undefined && typeof msg.method === 'string') {
    await handle(req, msg)
    return res.status(202).end()
  }
  res.json(await handle(req, msg))
})

// This server answers every request directly and has no event stream to subscribe to.
mcpRouter.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST' }))
mcpRouter.delete('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Use POST' }))
