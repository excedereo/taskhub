# API and AI agents

Scripts and AI agents can work in Taskhub on someone's behalf. They use a **personal API token** and can do exactly what that person's role allows: the same permissions, the same visible categories. Everything they change shows up in the history marked "via" the token's name.

## Tokens

1. An administrator gives the role the **Use the API and AI agents** permission (Roles page).
2. The person opens **Profile → API tokens and AI agents** and creates a token. It is shown once; Taskhub only keeps a hash.
3. Options: **Read only** (can look things up, cannot change anything) and an expiry (7, 30, 90 days, a year, or never).

A token stops working as soon as it is revoked, expires, its owner is disabled, or their role loses the permission. Tokens cannot create or revoke tokens; that is only possible from the website. Each token may make up to 120 requests a minute.

## MCP (for AI agents)

Taskhub has an MCP server at `/api/mcp` (Streamable HTTP). Claude Code:

```sh
claude mcp add --transport http taskhub https://your-taskhub.example/api/mcp --header "Authorization: Bearer th_..."
```

Other clients that take a JSON config:

```json
{
  "mcpServers": {
    "taskhub": {
      "type": "http",
      "url": "https://your-taskhub.example/api/mcp",
      "headers": { "Authorization": "Bearer th_..." }
    }
  }
}
```

Tools (a read-only token only gets the first three):

| Tool | What it does |
| --- | --- |
| `get_workspace` | You, your role and permissions, categories, statuses, priorities, labels, people |
| `list_tasks` | Find tasks by category, status, assignee, label or text; unfinished by default |
| `get_task` | One task with its description, subtasks and recent history |
| `create_task` | New task, or a subtask with `parent_id` |
| `update_task` | Change title, description, status, priority, category, due date or labels |
| `take_task` | Assign a task to yourself |
| `assign_task` | Assign to someone, or unassign |
| `archive_task` | Archive or restore |

Tools accept names as well as ids ("Bug reports", "High", "In review", a person's name), so agents rarely need to look ids up.

## REST

The website uses the same JSON API under `/api`. Send the token as a header:

```sh
curl https://your-taskhub.example/api/tasks?assignee=me -H "Authorization: Bearer th_..."
```

Useful endpoints:

| Method and path | |
| --- | --- |
| `GET /api/me` | The token's owner and permissions |
| `GET /api/categories`, `/api/statuses`, `/api/priorities`, `/api/labels`, `/api/users` | Reference data |
| `GET /api/tasks?categoryId=&statusId=&assignee=me\|none\|<id>&label=&q=` | Search tasks |
| `GET /api/tasks/:id` | A task with subtasks, attachments and history |
| `POST /api/tasks` | `{ categoryId, title, description?, priorityId?, assigneeId?, dueDate?, labelIds?, parentId? }` |
| `PATCH /api/tasks/:id` | Any of `title, description, statusId, priorityId, categoryId, dueDate, labelIds` |
| `POST /api/tasks/:id/take` | Take the task |
| `POST /api/tasks/:id/assign` | `{ userId }` or `{ userId: null }` |
| `POST /api/tasks/:id/archive` | `{ archived: true \| false }` |

Errors come back as `{ "error": "..." }` with a matching HTTP status (400 bad input, 401 bad token, 403 not allowed, 404 not found or not visible, 429 too many requests).
