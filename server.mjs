import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BODY_LIMIT = 128 * 1024;
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'taskflow_session';
const COLORS = ['navy', 'coral', 'green', 'purple'];
const STATUSES = ['todo', 'progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const BLOCK_TYPES = ['text', 'heading', 'checklist'];
const DEV_ORIGINS = new Set([
  'http://localhost:5173', 'http://localhost:5174',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
]);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}
const fail = (status, message, headers) => { throw new HttpError(status, message, headers); };
const now = () => new Date().toISOString();
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const derive = (password, salt) => new Promise((resolveHash, reject) => {
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error);
    else resolveHash(key);
  });
});
const DUMMY_SALT = randomBytes(32);
const DUMMY_HASH = await derive('taskflow-dummy-account-password', DUMMY_SALT);

function text(value, field, max, { required = false, trim = false } = {}) {
  if (typeof value !== 'string') fail(400, `${field} must be a string.`);
  if (value.length > max) fail(400, `${field} must be at most ${max} characters.`);
  const result = trim ? value.trim() : value;
  if (result.includes('\0') || (required && !result.trim())) fail(400, `${field} is invalid.`);
  return result;
}
function enumValue(value, field, allowed) {
  if (!allowed.includes(value)) fail(400, `${field} must be one of: ${allowed.join(', ')}.`);
  return value;
}
function boolean(value, field) {
  if (typeof value !== 'boolean') fail(400, `${field} must be a boolean.`);
  return value;
}
function email(value) {
  const result = text(value, 'email', 254, { required: true, trim: true }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result)) fail(400, 'Enter a valid email address.');
  return result;
}
function password(value, field, isNew = true) {
  const result = text(value, field, 128, { required: true });
  if (isNew && result.length < 8) fail(400, `${field} must have at least 8 characters.`);
  return result;
}
function date(value) {
  const result = text(value, 'dueDate', 10);
  if (result === '') return result;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result.startsWith('0000')) {
    fail(400, 'dueDate must be a valid YYYY-MM-DD date or an empty string.');
  }
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    fail(400, 'dueDate must be a valid YYYY-MM-DD date or an empty string.');
  }
  return result;
}
function labels(value) {
  if (!Array.isArray(value) || value.length > 10) fail(400, 'labels must be an array of at most 10 strings.');
  return [...new Set(value.map((label) => text(label, 'label', 40, { required: true, trim: true })))];
}
function shape(value, allowed, requireFields = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object.');
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(400, 'Unknown or read-only field.');
  for (const field of requireFields) {
    if (!Object.hasOwn(value, field)) fail(400, `${field} is required.`);
  }
  return value;
}
function blocks(value) {
  if (!Array.isArray(value) || value.length > 200) fail(400, 'blocks must be an array of at most 200 blocks.');
  const ids = new Set();
  return value.map((block) => {
    shape(block, ['id', 'type', 'content', 'checked'], ['id', 'type', 'content']);
    const id = text(block.id, 'block.id', 100, { required: true, trim: true });
    if (ids.has(id)) fail(400, 'Block IDs must be unique within a page.');
    ids.add(id);
    return {
      id, type: enumValue(block.type, 'block.type', BLOCK_TYPES),
      content: text(block.content, 'block.content', 10000),
      checked: Object.hasOwn(block, 'checked') ? boolean(block.checked, 'block.checked') : false,
    };
  });
}
const EDITABLE = {
  projects: ['name', 'description', 'color', 'favorite'],
  tasks: ['projectId', 'title', 'description', 'status', 'priority', 'dueDate', 'assignee', 'labels'],
  pages: ['projectId', 'title', 'blocks'],
};
function itemInput(kind, body, existing) {
  shape(body, EDITABLE[kind]);
  if (existing && Object.keys(body).length === 0) fail(400, 'Provide at least one editable field.');
  const defaults = {
    projects: { description: '', color: 'navy', favorite: false },
    tasks: { projectId: '', description: '', status: 'todo', priority: 'medium', dueDate: '', assignee: '', labels: [] },
    pages: { projectId: '', blocks: [] },
  };
  const input = { ...(existing || defaults[kind]), ...body };
  if (kind === 'projects') {
    return {
      name: text(input.name, 'name', 120, { required: true, trim: true }),
      description: text(input.description, 'description', 2000),
      color: enumValue(input.color, 'color', COLORS), favorite: boolean(input.favorite, 'favorite'),
    };
  }
  const shared = {
    projectId: text(input.projectId, 'projectId', 100),
    title: text(input.title, 'title', 200, { required: true, trim: true }),
  };
  if (kind === 'pages') return { ...shared, blocks: blocks(input.blocks) };
  return {
    ...shared, description: text(input.description, 'description', 4000),
    status: enumValue(input.status, 'status', STATUSES),
    priority: enumValue(input.priority, 'priority', PRIORITIES),
    dueDate: date(input.dueDate), assignee: text(input.assignee, 'assignee', 120), labels: labels(input.labels),
  };
}

function json(res, status, value, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers,
  });
  res.end(body);
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(req.headers['content-type'] || '')) {
    req.resume();
    fail(415, 'Content-Type must be application/json.');
  }
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
    req.resume();
    fail(415, 'Compressed request bodies are not supported.');
  }
  if (req.headers['content-length'] && Number(req.headers['content-length']) > BODY_LIMIT) {
    req.resume();
    fail(413, 'JSON body must not exceed 128 KB.');
  }
  const buffer = await new Promise((resolveBody, reject) => {
    let size = 0;
    let settled = false;
    let chunks = [];
    const rejectOnce = (error) => {
      if (!settled) {
        settled = true;
        chunks = [];
        reject(error);
      }
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > BODY_LIMIT) rejectOnce(new HttpError(413, 'JSON body must not exceed 128 KB.'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolveBody(Buffer.concat(chunks, size));
      }
    });
    req.on('aborted', () => rejectOnce(new HttpError(400, 'Request body was interrupted.')));
    req.on('error', () => rejectOnce(new HttpError(400, 'Unable to read request body.')));
  });
  if (buffer.length === 0) return {};
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    fail(400, 'Invalid JSON body.');
  }
  return shape(body, Object.keys(body && typeof body === 'object' ? body : {}));
}
function requestPath(req) {
  const raw = (req.url || '').split('?')[0];
  if (!raw.startsWith('/') || raw.startsWith('//')) fail(400, 'Invalid request path.');
  let path;
  try { path = decodeURIComponent(raw); } catch { fail(400, 'Invalid request path.'); }
  if ([...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\' || char === ':') || path.split('/').some((part) => part === '..' || part === '.')) {
    fail(400, 'Invalid request path.');
  }
  return path;
}
function originCheck(req, res) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (!origin) {
    if (req.headers['sec-fetch-site'] === 'cross-site' && !['GET', 'HEAD'].includes(req.method)) {
      fail(403, 'Request origin is not allowed.');
    }
    return;
  }
  let ownOrigin;
  try { ownOrigin = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`).origin; } catch {}
  if (typeof origin !== 'string' || (origin !== ownOrigin && !DEV_ORIGINS.has(origin))) {
    fail(403, 'Request origin is not allowed.');
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}
function sessionToken(req) {
  const matches = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function cookie(req, token) {
  const lifetime = token ? SESSION_LIFETIME : 0;
  return `${COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime / 1000}; Expires=${new Date(token ? Date.now() + lifetime : 0).toUTCString()}${req.socket.encrypted ? '; Secure' : ''}`;
}
function publicUser(row) { return { id: row.id, name: row.name, email: row.email }; }
function project(row) {
  return { id: row.id, name: row.name, description: row.description, color: row.color, favorite: Boolean(row.favorite), createdAt: row.created_at };
}
function task(row) {
  return {
    id: row.id, projectId: row.project_id || '', title: row.title, description: row.description,
    status: row.status, priority: row.priority, dueDate: row.due_date, assignee: row.assignee,
    labels: JSON.parse(row.labels), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at,
  };
}
function page(row) {
  return { id: row.id, projectId: row.project_id || '', title: row.title, blocks: JSON.parse(row.blocks), createdAt: row.created_at, updatedAt: row.updated_at };
}
const SERIALIZERS = { projects: project, tasks: task, pages: page };
const ROUTES = {
  '/api/session': ['GET', 'session'],
  '/api/auth/signup': ['POST', 'signup'],
  '/api/auth/login': ['POST', 'login'],
  '/api/auth/logout': ['POST', 'logout'],
  '/api/workspace': ['GET', 'workspace'],
  '/api/profile': ['PATCH', 'profile'],
  '/api/password': ['POST', 'password'],
  '/api/export': ['GET', 'export'],
  '/api/example': ['POST', 'example'],
  '/api/projects': ['POST', 'projects'],
  '/api/tasks': ['POST', 'tasks'],
  '/api/pages': ['POST', 'pages'],
};

export function createTaskFlowServer({ databasePath = process.env.TASKFLOW_DB || join(ROOT, 'data', 'taskflow.db') } = {}) {
  const dbPath = databasePath === ':memory:' ? databasePath : resolve(ROOT, databasePath);
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
        description TEXT NOT NULL CHECK(length(description) <= 2000),
        color TEXT NOT NULL CHECK(color IN ('navy','coral','green','purple')),
        favorite INTEGER NOT NULL CHECK(favorite IN (0,1)), created_at TEXT NOT NULL,
        UNIQUE(id, user_id)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
        description TEXT NOT NULL CHECK(length(description) <= 4000),
        status TEXT NOT NULL CHECK(status IN ('todo','progress','review','done')),
        priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
        due_date TEXT NOT NULL, assignee TEXT NOT NULL CHECK(length(assignee) <= 120),
        labels TEXT NOT NULL CHECK(json_valid(labels)), created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, completed_at TEXT,
        CHECK((status = 'done' AND completed_at IS NOT NULL) OR (status != 'done' AND completed_at IS NULL)),
        FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
        blocks TEXT NOT NULL CHECK(json_valid(blocks)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id, user_id) REFERENCES projects(id, user_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS activity (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL, date TEXT NOT NULL
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
      COMMIT;
    `);
  } catch (error) {
    db.close();
    throw error;
  }
  const statements = new Map();
  const sql = (query) => {
    if (!statements.has(query)) statements.set(query, db.prepare(query));
    return statements.get(query);
  };
  const transaction = (work, write = true) => {
    db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  };
  const activity = (owner, message, timestamp = now()) => {
    sql('INSERT INTO activity (id, user_id, text, date) VALUES (?, ?, ?, ?)').run(randomUUID(), owner, message, timestamp);
    sql('DELETE FROM activity WHERE user_id = ? AND seq NOT IN (SELECT seq FROM activity WHERE user_id = ? ORDER BY seq DESC LIMIT 100)').run(owner, owner);
  };
  const readItem = (kind, owner, id) => {
    const row = sql(`SELECT * FROM ${kind} WHERE user_id = ? AND id = ?`).get(owner, id);
    if (!row) fail(404, 'Item not found.');
    return SERIALIZERS[kind](row);
  };
  const checkProject = (owner, projectId) => {
    if (projectId && !sql('SELECT id FROM projects WHERE user_id = ? AND id = ?').get(owner, projectId)) {
      fail(400, 'projectId must refer to one of your projects, or be empty for the inbox.');
    }
  };
  const limit = (kind, owner) => {
    const limits = { projects: 100, tasks: 5000, pages: 500 };
    const count = sql(`SELECT COUNT(*) AS count FROM ${kind} WHERE user_id = ?`).get(owner).count;
    if (count >= limits[kind]) fail(409, `Workspace limit reached: at most ${limits[kind]} ${kind}. Delete an item before adding another.`);
  };
  const insertItem = (kind, owner, input, timestamp = now(), completedAt) => {
    limit(kind, owner);
    if (kind !== 'projects') checkProject(owner, input.projectId);
    const id = randomUUID();
    if (kind === 'projects') {
      sql('INSERT INTO projects (id, user_id, name, description, color, favorite, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, owner, input.name, input.description, input.color, Number(input.favorite), timestamp);
    } else if (kind === 'tasks') {
      const completion = input.status === 'done' ? (completedAt || timestamp) : null;
      sql('INSERT INTO tasks (id, user_id, project_id, title, description, status, priority, due_date, assignee, labels, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, owner, input.projectId || null, input.title, input.description, input.status, input.priority,
          input.dueDate, input.assignee, JSON.stringify(input.labels), timestamp, completion || timestamp, completion);
    } else {
      sql('INSERT INTO pages (id, user_id, project_id, title, blocks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, owner, input.projectId || null, input.title, JSON.stringify(input.blocks), timestamp, timestamp);
    }
    const item = readItem(kind, owner, id);
    activity(owner, `Created ${kind.slice(0, -1)} “${item.name || item.title}”.`);
    return item;
  };
  const updateItem = (kind, owner, id, body) => transaction(() => {
    const existing = readItem(kind, owner, id);
    const input = itemInput(kind, body, existing);
    const timestamp = now();
    if (kind !== 'projects') checkProject(owner, input.projectId);
    if (kind === 'projects') {
      sql('UPDATE projects SET name = ?, description = ?, color = ?, favorite = ? WHERE user_id = ? AND id = ?')
        .run(input.name, input.description, input.color, Number(input.favorite), owner, id);
    } else if (kind === 'tasks') {
      const completedAt = input.status === 'done' ? (existing.completedAt || timestamp) : null;
      sql('UPDATE tasks SET project_id = ?, title = ?, description = ?, status = ?, priority = ?, due_date = ?, assignee = ?, labels = ?, updated_at = ?, completed_at = ? WHERE user_id = ? AND id = ?')
        .run(input.projectId || null, input.title, input.description, input.status, input.priority,
          input.dueDate, input.assignee, JSON.stringify(input.labels), timestamp, completedAt, owner, id);
    } else {
      sql('UPDATE pages SET project_id = ?, title = ?, blocks = ?, updated_at = ? WHERE user_id = ? AND id = ?')
        .run(input.projectId || null, input.title, JSON.stringify(input.blocks), timestamp, owner, id);
    }
    activity(owner, `Updated ${kind.slice(0, -1)} “${input.name || input.title}”.`, timestamp);
    return readItem(kind, owner, id);
  });
  const deleteItem = (kind, owner, id) => transaction(() => {
    const existing = readItem(kind, owner, id);
    sql(`DELETE FROM ${kind} WHERE user_id = ? AND id = ?`).run(owner, id);
    activity(owner, `Deleted ${kind.slice(0, -1)} “${existing.name || existing.title}”${kind === 'projects' ? ' and its tasks and pages' : ''}.`);
    return { ok: true };
  });
  const readWorkspace = (owner) => ({
    projects: sql('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at, id').all(owner).map(project),
    tasks: sql('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC, id').all(owner).map(task),
    pages: sql('SELECT * FROM pages WHERE user_id = ? ORDER BY updated_at DESC, id').all(owner).map(page),
    activity: sql('SELECT id, text, date FROM activity WHERE user_id = ? ORDER BY seq DESC LIMIT 30').all(owner)
      .map((row) => ({ id: row.id, text: row.text, date: row.date })),
  });
  const workspace = (owner) => transaction(() => readWorkspace(owner), false);
  const auth = (req) => {
    const token = sessionToken(req);
    if (!token) return null;
    const row = sql('SELECT u.id, u.name, u.email FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?')
      .get(tokenHash(token), Date.now());
    return row ? { user: publicUser(row), hash: tokenHash(token) } : null;
  };
  const requireAuth = (req) => {
    const session = auth(req);
    if (!session) fail(401, 'Please sign in to continue.');
    return session;
  };
  const issueSession = (owner, oldSession) => {
    if (oldSession) sql('DELETE FROM sessions WHERE user_id = ? AND token_hash = ?').run(oldSession.user.id, oldSession.hash);
    const timestamp = Date.now();
    sql('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').run(owner, timestamp);
    sql('DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, token_hash LIMIT 19)').run(owner, owner);
    const token = randomBytes(32).toString('base64url');
    sql('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash(token), owner, timestamp, timestamp + SESSION_LIFETIME);
    return token;
  };

  const authAttempts = new Map();
  const RATE_WINDOW = 15 * 60 * 1000;
  const pruneAttempts = () => {
    const timestamp = Date.now();
    for (const [ip, entry] of authAttempts) if (entry.reset <= timestamp) authAttempts.delete(ip);
  };
  const rateLimit = (req) => {
    const timestamp = Date.now();
    const ip = req.socket.remoteAddress || 'unknown';
    let entry = authAttempts.get(ip);
    if (!entry || entry.reset <= timestamp) {
      if (authAttempts.size >= 10000) pruneAttempts();
      if (!authAttempts.has(ip) && authAttempts.size >= 10000) {
        fail(429, 'Too many authentication requests. Try again shortly.', { 'Retry-After': '60' });
      }
      entry = { count: 0, reset: timestamp + RATE_WINDOW };
      authAttempts.set(ip, entry);
    }
    if (entry.count >= 20) fail(429, 'Too many authentication attempts. Try again later.', {
      'Retry-After': String(Math.max(1, Math.ceil((entry.reset - timestamp) / 1000))),
    });
    entry.count += 1;
  };
  let activeHashes = 0;
  const hashPassword = async (value, salt) => {
    if (activeHashes >= 8) fail(429, 'Authentication is busy. Try again shortly.', { 'Retry-After': '5' });
    activeHashes += 1;
    try { return await derive(value, salt); } finally { activeHashes -= 1; }
  };
  const matchesPassword = async (value, row) => {
    const actual = await hashPassword(value, row ? Buffer.from(row.password_salt, 'hex') : DUMMY_SALT);
    const expected = row ? Buffer.from(row.password_hash, 'hex') : DUMMY_HASH;
    const match = expected.length === actual.length && timingSafeEqual(actual, expected);
    return Boolean(row) && match;
  };
  sql('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const cleanup = setInterval(() => {
    pruneAttempts();
    try { sql('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()); } catch {}
  }, 60 * 1000);
  cleanup.unref();

  const example = (owner, name) => transaction(() => {
    for (const kind of ['projects', 'tasks', 'pages']) {
      if (sql(`SELECT 1 FROM ${kind} WHERE user_id = ? LIMIT 1`).get(owner)) {
        fail(409, 'Example content can only be added to an empty workspace.');
      }
    }
    const timestamp = now();
    const day = (offset) => {
      const result = new Date();
      result.setUTCHours(12, 0, 0, 0);
      result.setUTCDate(result.getUTCDate() + offset);
      return result.toISOString();
    };
    const projects = [
      { name: 'Website launch', description: 'Plan, build, and launch a welcoming website with a clear story.', color: 'navy', favorite: true },
      { name: 'School & learning', description: 'Keep coursework, study habits, and new skills moving forward.', color: 'purple', favorite: true },
      { name: 'Personal', description: 'Make room for health, home, and the things that matter outside work.', color: 'green', favorite: false },
    ].map((input) => insertItem('projects', owner, itemInput('projects', input), timestamp));
    const examples = [
      [0, 'Write the homepage story', 'Describe the audience, the problem we solve, and one clear call to action.', 'done', 'high', -6, ['Content']],
      [0, 'Sketch the navigation', 'Keep the main menu to five destinations and include a mobile layout.', 'done', 'medium', -4, ['Design']],
      [0, 'Build responsive landing page', 'Implement the approved layout and test small screens and keyboard navigation.', 'progress', 'high', 2, ['Development']],
      [0, 'Review accessibility and launch checklist', 'Check contrast, form labels, metadata, redirects, and the final deployment plan.', 'review', 'high', 4, ['Launch']],
      [1, 'Summarize this week’s reading', 'Turn the key ideas into a one-page summary with three questions for class.', 'done', 'medium', -3, ['Reading']],
      [1, 'Practice algebra problems', 'Work through ten equations and revisit the steps behind any mistakes.', 'progress', 'medium', 1, ['Study']],
      [1, 'Prepare research outline', 'Choose a focused question, collect three sources, and draft the main sections.', 'todo', 'high', 5, ['Coursework']],
      [1, 'Review flashcards with a friend', 'Run a twenty-minute recall session and flag difficult concepts.', 'review', 'low', 3, ['Revision']],
      [2, 'Plan meals for the week', 'Choose four simple dinners and make a grocery list before shopping.', 'done', 'low', -1, ['Home']],
      [2, 'Book a routine checkup', 'Check appointment availability and add the confirmed visit to the calendar.', 'todo', 'medium', 6, ['Health']],
      [2, 'Organize the desk', 'Sort loose papers, recycle what is no longer needed, and clear a workspace.', 'progress', 'low', 0, ['Home']],
      [2, 'Take a weekend walk', 'Pick a local trail and set aside an hour without screens.', 'todo', 'low', 7, ['Wellbeing']],
    ];
    for (const [index, title, description, status, priority, offset, taskLabels] of examples) {
      const input = itemInput('tasks', {
        projectId: projects[index].id, title, description, status, priority,
        dueDate: day(offset).slice(0, 10), assignee: name, labels: taskLabels,
      });
      insertItem('tasks', owner, input, day(-8), status === 'done' ? day(offset) : undefined);
    }
    const block = (type, content, checked = false) => ({ id: randomUUID(), type, content, checked });
    insertItem('pages', owner, itemInput('pages', {
      projectId: projects[0].id, title: 'Website launch brief', blocks: [
        block('heading', 'A clear, useful first impression'),
        block('text', 'Our website should help visitors understand what we offer in under a minute. Use plain language, generous spacing, and a single primary next step.'),
        block('heading', 'Definition of ready'),
        block('checklist', 'Agree on the audience and homepage story', true),
        block('checklist', 'Test mobile navigation and keyboard access'),
        block('checklist', 'Verify contact forms, analytics, and launch redirects'),
        block('text', 'After launch, review visitor feedback and conversion data weekly. Keep a short list of improvements rather than changing everything at once.'),
      ],
    }), timestamp);
    insertItem('pages', owner, itemInput('pages', {
      projectId: projects[1].id, title: 'Weekly learning plan', blocks: [
        block('heading', 'Learn a little, consistently'),
        block('text', 'Reserve three focused study sessions this week. Start with active recall, work through a small set of practice questions, and finish with a short reflection.'),
        block('checklist', 'Choose the week’s most important concepts', true),
        block('checklist', 'Complete two practice sessions without distractions'),
        block('checklist', 'Explain one difficult idea to a friend'),
        block('heading', 'Friday reflection'),
        block('text', 'What became clearer? Which questions remain? Write one concrete change to try next week.'),
      ],
    }), timestamp);
    activity(owner, 'Added example projects, tasks, and pages.', timestamp);
    return readWorkspace(owner);
  });

  async function serveStatic(req, res, path) {
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    if (path.split('/').some((part) => part.startsWith('.'))) fail(404, 'Not found.');
    let root;
    try { root = await realpath(join(ROOT, 'dist')); } catch { fail(503, 'Frontend build not found. Build the Vite app first.'); }
    const inside = (target) => {
      const part = relative(root, target);
      return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
    };
    const candidate = resolve(root, `.${path}`);
    if (!inside(candidate)) fail(404, 'Not found.');
    let handle;
    let target;
    let info;
    const tryFile = async (filename) => {
      let file;
      try {
        const canonical = await realpath(filename);
        if (!inside(canonical)) fail(404, 'Not found.');
        file = await open(canonical, 'r');
        const stat = await file.stat();
        if (!stat.isFile()) { await file.close(); return false; }
        handle = file;
        target = canonical;
        info = stat;
        return true;
      } catch (error) {
        if (file) await file.close().catch(() => {});
        if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return false;
        throw error;
      }
    };
    if (!(await tryFile(candidate))) {
      if (extname(path)) fail(404, 'Not found.');
      if (!(await tryFile(join(root, 'index.html')))) fail(503, 'Frontend build not found. Build the Vite app first.');
    }
    if (res.destroyed) { await handle.close(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size, 'Last-Modified': info.mtime.toUTCString(),
      'Cache-Control': extname(target).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') { await handle.close(); res.end(); return; }
    const stream = handle.createReadStream();
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const path = requestPath(req);
      if (path !== '/api' && !path.startsWith('/api/')) {
        await serveStatic(req, res, path);
        return;
      }
      originCheck(req, res);
      const resource = /^\/api\/(projects|tasks|pages)\/([^/]+)$/.exec(path);
      const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : null;
      if (!route && !resource) fail(404, 'API route not found.');
      const methods = resource ? ['PATCH', 'DELETE'] : [route[0]];
      if (req.method === 'OPTIONS') {
        if (!req.headers.origin || !methods.includes(req.headers['access-control-request-method'])) {
          fail(400, 'Invalid preflight request.');
        }
        const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((value) => value.trim()).filter(Boolean);
        if (headers.some((header) => header !== 'content-type')) fail(403, 'Request headers are not allowed.');
        res.writeHead(204, {
          'Access-Control-Allow-Methods': methods.join(', '), 'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store',
          Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
        });
        res.end();
        return;
      }
      if (!methods.includes(req.method)) fail(405, 'Method not allowed.', { Allow: methods.join(', ') });
      const action = resource ? resource[1] : route[1];
      if (['signup', 'login', 'password'].includes(action)) rateLimit(req);
      const body = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : null;

      if (action === 'session') {
        json(res, 200, { user: auth(req)?.user || null });
        return;
      }
      if (action === 'signup') {
        shape(body, ['name', 'email', 'password'], ['name', 'email', 'password']);
        const name = text(body.name, 'name', 100, { required: true, trim: true });
        const address = email(body.email);
        const secret = password(body.password, 'password');
        if (sql('SELECT id FROM users WHERE email = ?').get(address)) fail(409, 'An account with this email already exists.');
        const salt = randomBytes(32);
        const hash = await hashPassword(secret, salt);
        const oldSession = auth(req);
        const result = transaction(() => {
          if (sql('SELECT id FROM users WHERE email = ?').get(address)) fail(409, 'An account with this email already exists.');
          const user = { id: randomUUID(), name, email: address };
          sql('INSERT INTO users (id, name, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(user.id, name, address, salt.toString('hex'), hash.toString('hex'), now());
          return { user, token: issueSession(user.id, oldSession) };
        });
        json(res, 201, { user: result.user }, { 'Set-Cookie': cookie(req, result.token) });
        return;
      }
      if (action === 'login') {
        shape(body, ['email', 'password'], ['email', 'password']);
        const address = email(body.email);
        const secret = password(body.password, 'password', false);
        const row = sql('SELECT * FROM users WHERE email = ?').get(address);
        if (!(await matchesPassword(secret, row))) fail(401, 'Invalid email or password.');
        const oldSession = auth(req);
        const result = transaction(() => {
          const current = sql('SELECT id, name, email FROM users WHERE id = ? AND password_hash = ? AND password_salt = ?')
            .get(row.id, row.password_hash, row.password_salt);
          if (!current) fail(401, 'Invalid email or password.');
          return { user: publicUser(current), token: issueSession(current.id, oldSession) };
        });
        json(res, 200, { user: result.user }, { 'Set-Cookie': cookie(req, result.token) });
        return;
      }
      if (action === 'logout') {
        shape(body, []);
        const session = auth(req);
        if (session) transaction(() => sql('DELETE FROM sessions WHERE user_id = ? AND token_hash = ?').run(session.user.id, session.hash));
        json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, null) });
        return;
      }

      const session = requireAuth(req);
      const owner = session.user.id;
      if (action === 'workspace' || action === 'export') {
        json(res, 200, workspace(owner), action === 'export' ? { 'Content-Disposition': 'attachment; filename="taskflow-export.json"' } : {});
      } else if (action === 'profile') {
        shape(body, ['name'], ['name']);
        const name = text(body.name, 'name', 100, { required: true, trim: true });
        const user = transaction(() => {
          sql('UPDATE users SET name = ? WHERE id = ?').run(name, owner);
          activity(owner, 'Updated profile name.');
          return publicUser(sql('SELECT id, name, email FROM users WHERE id = ?').get(owner));
        });
        json(res, 200, { user });
      } else if (action === 'password') {
        shape(body, ['currentPassword', 'newPassword'], ['currentPassword', 'newPassword']);
        const currentPassword = password(body.currentPassword, 'currentPassword', false);
        const newPassword = password(body.newPassword, 'newPassword');
        const row = sql('SELECT password_salt, password_hash FROM users WHERE id = ?').get(owner);
        if (!(await matchesPassword(currentPassword, row))) fail(400, 'Current password is incorrect.');
        const salt = randomBytes(32);
        const hash = await hashPassword(newPassword, salt);
        transaction(() => {
          const currentSession = auth(req);
          if (!currentSession || currentSession.user.id !== owner || currentSession.hash !== session.hash) fail(401, 'Please sign in to continue.');
          const changed = sql('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ? AND password_hash = ? AND password_salt = ?')
            .run(salt.toString('hex'), hash.toString('hex'), owner, row.password_hash, row.password_salt);
          if (changed.changes !== 1) fail(409, 'Password changed during this request. Please try again.');
          sql('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(owner, session.hash);
          activity(owner, 'Updated account password.');
        });
        json(res, 200, { ok: true });
      } else if (action === 'example') {
        shape(body, []);
        json(res, 201, example(owner, session.user.name));
      } else if (resource) {
        const id = text(resource[2], 'id', 100, { required: true });
        if (req.method === 'DELETE') {
          shape(body, []);
          json(res, 200, deleteItem(action, owner, id));
        } else json(res, 200, updateItem(action, owner, id, body));
      } else {
        const input = itemInput(action, body);
        const item = transaction(() => insertItem(action, owner, input));
        json(res, 201, item);
      }
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json(res, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : 'Unable to complete the request. Please try again.',
      }, error instanceof HttpError ? error.headers : {});
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.timeout = 30000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 100;
  server.on('close', () => {
    clearInterval(cleanup);
    db.close();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let server;
  try {
    const host = process.env.HOST || '127.0.0.1';
    const portText = process.env.PORT ?? '3001';
    if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) throw new Error('Invalid port');
    server = createTaskFlowServer();
    server.on('error', () => {
      console.error('TaskFlow could not start. Check database access and HOST/PORT.');
      server.close();
      process.exitCode = 1;
    });
    server.listen(Number(portText), host, () => {
      console.log(`TaskFlow is listening on port ${server.address().port}.`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      server.close();
      server.closeIdleConnections();
    });
  } catch {
    console.error('TaskFlow could not start. Check database access and HOST/PORT.');
    if (server) server.close();
    process.exitCode = 1;
  }
}
