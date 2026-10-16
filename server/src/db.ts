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
