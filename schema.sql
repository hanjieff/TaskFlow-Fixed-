PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK(length(description) <= 2000),
  color TEXT NOT NULL CHECK(color IN ('navy','coral','green','purple')),
  favorite INTEGER NOT NULL CHECK(favorite IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL CHECK(length(description) <= 4000),
  status TEXT NOT NULL CHECK(status IN ('todo','progress','review','done')),
  priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
  due_date TEXT NOT NULL,
  assignee TEXT NOT NULL CHECK(length(assignee) <= 120),
  labels TEXT NOT NULL CHECK(json_valid(labels)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK((status = 'done' AND completed_at IS NOT NULL) OR (status != 'done' AND completed_at IS NULL)),
  FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  blocks TEXT NOT NULL CHECK(json_valid(blocks)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(user_id, created_at);
CREATE INDEX IF NOT EXISTS tasks_owner_project ON tasks(user_id, project_id);
CREATE INDEX IF NOT EXISTS tasks_owner_due ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS tasks_owner_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS pages_owner_project ON pages(user_id, project_id);
CREATE INDEX IF NOT EXISTS pages_owner_updated ON pages(user_id, updated_at);
CREATE INDEX IF NOT EXISTS activity_owner ON activity(user_id, seq DESC);