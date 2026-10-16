import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.ts'

mkdirSync(path.dirname(config.dbPath), { recursive: true })

export const db = new DatabaseSync(config.dbPath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

// Append-only: each entry runs once, tracked by PRAGMA user_version.
const migrations: string[] = [
  `
  CREATE TABLE roles (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color       TEXT,
    permissions TEXT NOT NULL DEFAULT '[]',
    is_system   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    discord_id    TEXT NOT NULL UNIQUE,
    username      TEXT,
    display_name  TEXT,
    avatar        TEXT,
    role_id       INTEGER NOT NULL REFERENCES roles(id),
    status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    archived    INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE tasks (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'review', 'done')),
    priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    creator_id  INTEGER REFERENCES users(id),
    assignee_id INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    closed_at   INTEGER
  );
  CREATE INDEX tasks_category ON tasks(category_id);
  CREATE INDEX tasks_assignee ON tasks(assignee_id);

  CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY,
    actor_id    INTEGER REFERENCES users(id),
    entity_type TEXT NOT NULL,
    entity_id   INTEGER,
    action      TEXT NOT NULL,
    data        TEXT NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX audit_entity ON audit_log(entity_type, entity_id);
  CREATE INDEX audit_actor ON audit_log(actor_id);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT INTO roles (id, name, color, permissions, is_system, created_at)
    VALUES (1, 'Owner', '#e5484d', '["admin"]', 1, unixepoch() * 1000),
           (2, 'Member', NULL, '["create_tasks","take_tasks"]', 0, unixepoch() * 1000);

  INSERT INTO settings (key, value) VALUES
    ('instance_name', '"Taskhub"'),
    ('registration', '"invite"'),
    ('default_role_id', '2');
  `,
  `
  CREATE TABLE attachments (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    uploader_id INTEGER REFERENCES users(id),
    file        TEXT NOT NULL,
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    width       INTEGER,
    height      INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX attachments_task ON attachments(task_id);
  `,
  `
  -- Subtasks are ordinary tasks with a parent (one level deep).
  ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
  -- Manual order inside a category; top-level tasks share it with sections, subtasks with their siblings.
  ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0;
  UPDATE tasks SET position = id;
  CREATE INDEX tasks_parent ON tasks(parent_id);

  CREATE TABLE sections (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    position    REAL NOT NULL,
    created_by  INTEGER REFERENCES users(id),
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX sections_category ON sections(category_id);
  `,
  `
  -- Archived tasks are hidden from lists, counters and analytics but kept with their history.
  ALTER TABLE tasks ADD COLUMN archived_at INTEGER;
  CREATE INDEX tasks_archived ON tasks(archived_at);
  `,
  `
  -- JSON list of category ids a role may create tasks in; NULL means every category.
  ALTER TABLE roles ADD COLUMN create_categories TEXT;
  `,
  `
  -- JSON list of category ids a role can see at all; NULL means every category.
  ALTER TABLE roles ADD COLUMN view_categories TEXT;
  `,
  `
  CREATE TABLE labels (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE task_labels (
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );
  CREATE INDEX task_labels_label ON task_labels(label_id);
  -- A calendar day (YYYY-MM-DD); the deadline is the end of that day.
  ALTER TABLE tasks ADD COLUMN due_date TEXT;
  CREATE INDEX tasks_due ON tasks(due_date);
  `,
  `
  -- Manual order of categories in the sidebar, shared by everyone.
  ALTER TABLE categories ADD COLUMN position REAL NOT NULL DEFAULT 0;
  UPDATE categories SET position = id;
  `,
  `
  -- Priorities become editable. The old text column stays (its CHECK cannot be dropped in place)
  -- but is no longer read; priority_id is the source of truth.
  CREATE TABLE priorities (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color      TEXT NOT NULL,
    position   REAL NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  INSERT INTO priorities (id, name, color, position, is_default, created_at) VALUES
    (1, 'High', '#dc2626', 1, 0, unixepoch() * 1000),
    (2, 'Medium', '#ea580c', 2, 1, unixepoch() * 1000),
    (3, 'Low', '#a1a1aa', 3, 0, unixepoch() * 1000);
  ALTER TABLE tasks ADD COLUMN priority_id INTEGER REFERENCES priorities(id);
  UPDATE tasks SET priority_id = CASE priority WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END;
  CREATE INDEX tasks_priority ON tasks(priority_id);
  `,
  `
  -- Statuses become editable. Like priorities, the old text column stays but is no longer read.
  CREATE TABLE statuses (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color      TEXT NOT NULL,
    icon       TEXT,
    type       TEXT NOT NULL CHECK (type IN ('todo', 'active', 'done')),
    position   REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  INSERT INTO statuses (id, name, color, icon, type, position, created_at) VALUES
    (1, 'Open', '#a1a1aa', 'circle-dashed', 'todo', 1, unixepoch() * 1000),
    (2, 'In progress', '#ea580c', 'loader', 'active', 2, unixepoch() * 1000),
    (3, 'In review', '#6e56cf', 'eye', 'active', 3, unixepoch() * 1000),
    (4, 'Done', '#16a34a', 'circle-check', 'done', 4, unixepoch() * 1000);
  ALTER TABLE tasks ADD COLUMN status_id INTEGER REFERENCES statuses(id);
  UPDATE tasks SET status_id = CASE status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'review' THEN 3 ELSE 4 END;
  CREATE INDEX tasks_status ON tasks(status_id);
  ALTER TABLE priorities ADD COLUMN icon TEXT;
  `,
  `
  -- Two more defaults: "Acknowledged" (seen it, will pick it up soon) right after the last
  -- not-started status, and "Light" just above Low. Skipped if the name exists.
  INSERT INTO statuses (name, color, icon, type, position, created_at)
    SELECT 'Acknowledged', '#0090ff', 'thumbs-up', 'todo',
           COALESCE((SELECT MAX(position) FROM statuses WHERE type = 'todo'), 0) + 0.5, unixepoch() * 1000
    WHERE NOT EXISTS (SELECT 1 FROM statuses WHERE name = 'Acknowledged');
  INSERT INTO priorities (name, color, icon, position, is_default, created_at)
    SELECT 'Light', '#12a594', NULL,
           COALESCE((SELECT position FROM priorities WHERE name = 'Low') - 0.5, (SELECT MAX(position) FROM priorities) + 1, 1), 0, unixepoch() * 1000
    WHERE NOT EXISTS (SELECT 1 FROM priorities WHERE name = 'Light');
  `,
  `
  -- Discord webhooks that receive a feed of chosen events.
  CREATE TABLE webhooks (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL,
    events       TEXT,            -- JSON list of event kinds; NULL means every kind
    categories   TEXT,            -- JSON list of category ids; NULL means every category
    enabled      INTEGER NOT NULL DEFAULT 1,
    last_error   TEXT,
    last_sent_at INTEGER,
    created_by   INTEGER REFERENCES users(id),
    created_at   INTEGER NOT NULL
  );
  -- Ready-made embeds waiting to be sent; kept in the database so a restart loses nothing.
  CREATE TABLE webhook_queue (
    id         INTEGER PRIMARY KEY,
    webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    embed      TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX webhook_queue_hook ON webhook_queue(webhook_id, id);
  `,
  `
  -- Themes shared by the workspace: six base colours plus optional CSS for effects.
  CREATE TABLE themes (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    base       TEXT NOT NULL CHECK (base IN ('light', 'dark')),
    colors     TEXT NOT NULL,
    css        TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
]

const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
for (let i = current; i < migrations.length; i++) {
  transaction(() => {
    db.exec(migrations[i])
    db.exec(`PRAGMA user_version = ${i + 1}`)
  })
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function getSetting<T>(key: string): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return (row ? JSON.parse(row.value) : null) as T
}

export function setSetting(key: string, value: unknown) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value))
}
