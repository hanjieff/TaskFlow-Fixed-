import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createTaskFlowServer } from '../server.mjs'

async function fixture(t, databasePath = ':memory:') {
  const server = createTaskFlowServer({ databasePath })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  async function request(path, method = 'GET', body, cookie = '', extraHeaders = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}),
        ...(['POST', 'PATCH', 'DELETE'].includes(method) ? { 'Content-Type': 'application/json', Origin: base } : {}), ...extraHeaders },
      body: ['POST', 'PATCH', 'DELETE'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    })
    return { status: response.status, headers: response.headers, data: await response.json() }
  }
  async function signup(email = 'alex@example.test') {
    const result = await request('/auth/signup', 'POST', { name: 'Alex Chen', email, password: 'TestPassword!123' })
    assert.equal(result.status, 201)
    return { ...result, cookie: result.headers.get('set-cookie').split(';')[0] }
  }
  return { server, base, request, signup }
}

test('real accounts, hashed passwords, opaque sessions and logout', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'taskflow-auth-'))
  const path = join(directory, 'test.db')
  const { request, signup } = await fixture(t, path)
  t.after(() => rm(directory, { recursive: true, force: true }))
  assert.equal((await request('/session')).data.user, null)
  assert.equal((await request('/workspace')).status, 401)
  const account = await signup(' ALEX@EXAMPLE.TEST ')
  assert.equal(account.data.user.email, 'alex@example.test')
  assert.match(account.headers.get('set-cookie'), /HttpOnly/)
  assert.match(account.headers.get('set-cookie'), /SameSite=Lax/)
  const db = new DatabaseSync(path)
  const stored = db.prepare('SELECT * FROM users').get()
  assert.notEqual(stored.password_hash, 'TestPassword!123')
  assert.equal(stored.password_hash.length, 128)
  assert.equal(stored.password_salt.length, 64)
  assert.notEqual(db.prepare('SELECT token_hash FROM sessions').get().token_hash, account.cookie.split('=')[1])
  db.close()
  assert.equal((await request('/auth/signup', 'POST', { name: 'Other', email: 'alex@example.test', password: 'password123' })).status, 409)
  assert.equal((await request('/auth/login', 'POST', { email: 'alex@example.test', password: 'incorrect' })).status, 401)
  assert.equal((await request('/session', 'GET', undefined, account.cookie)).data.user.id, account.data.user.id)
  assert.deepEqual((await request('/workspace', 'GET', undefined, account.cookie)).data, { projects: [], tasks: [], pages: [], activity: [] })
  assert.equal((await request('/auth/logout', 'POST', {}, account.cookie)).status, 200)
  assert.equal((await request('/workspace', 'GET', undefined, account.cookie)).status, 401)
})

test('projects, tasks and page blocks persist, update and cascade safely', async t => {
  const { request, signup } = await fixture(t)
  const { cookie } = await signup()
  const project = (await request('/projects', 'POST', { name: 'Robot prototype', color: 'coral', description: 'Build the next idea.' }, cookie)).data
  assert.equal(project.name, 'Robot prototype')
  const task = (await request('/tasks', 'POST', { projectId: project.id, title: 'Test obstacle sensor', dueDate: '2026-10-22', labels: ['Hardware', 'Hardware'] }, cookie)).data
  assert.deepEqual(task.labels, ['Hardware'])
  assert.equal(task.completedAt, null)
  const completed = await request(`/tasks/${task.id}`, 'PATCH', { status: 'done' }, cookie)
  assert.equal(completed.data.status, 'done')
  assert.ok(completed.data.completedAt)
  const reopened = await request(`/tasks/${task.id}`, 'PATCH', { status: 'todo' }, cookie)
  assert.equal(reopened.data.completedAt, null)
  const note = (await request('/pages', 'POST', { title: 'Build notes', projectId: project.id, blocks: [{ id: 'block-a', type: 'heading', content: 'Sensors', checked: false }, { id: 'block-b', type: 'checklist', content: 'Calibrate', checked: true }] }, cookie)).data
  assert.equal(note.blocks[1].checked, true)
  assert.equal((await request(`/pages/${note.id}`, 'PATCH', { title: 'Updated notes' }, cookie)).data.title, 'Updated notes')
  const inbox = (await request('/tasks', 'POST', { title: 'Loose idea' }, cookie)).data
  assert.equal(inbox.projectId, '')
  assert.equal((await request(`/projects/${project.id}`, 'PATCH', { favorite: true }, cookie)).data.favorite, true)
  assert.equal((await request(`/projects/${project.id}`, 'DELETE', {}, cookie)).status, 200)
  const workspace = (await request('/workspace', 'GET', undefined, cookie)).data
  assert.equal(workspace.projects.length, 0)
  assert.equal(workspace.pages.length, 0)
  assert.deepEqual(workspace.tasks.map(item => item.id), [inbox.id])
  assert.ok(workspace.activity.length)
  assert.equal((await request(`/tasks/${inbox.id}`, 'DELETE', {}, cookie)).status, 200)
})

test('account boundaries cannot be bypassed with guessed IDs or project links', async t => {
  const { request, signup } = await fixture(t)
  const alice = await signup('alice@example.test'), bob = await signup('bob@example.test')
  const project = (await request('/projects', 'POST', { name: 'Private' }, alice.cookie)).data
  const task = (await request('/tasks', 'POST', { title: 'Private task', projectId: project.id }, alice.cookie)).data
  const page = (await request('/pages', 'POST', { title: 'Private page', blocks: [] }, alice.cookie)).data
  for (const [kind, id] of [['projects', project.id], ['tasks', task.id], ['pages', page.id]]) {
    assert.equal((await request(`/${kind}/${id}`, 'PATCH', kind === 'projects' ? { name: 'Stolen' } : { title: 'Stolen' }, bob.cookie)).status, 404)
    assert.equal((await request(`/${kind}/${id}`, 'DELETE', {}, bob.cookie)).status, 404)
  }
  assert.equal((await request('/tasks', 'POST', { title: 'Cross-account link', projectId: project.id }, bob.cookie)).status, 400)
  assert.equal((await request('/pages', 'POST', { title: 'Cross-account page', projectId: project.id }, bob.cookie)).status, 400)
  assert.equal((await request('/workspace', 'GET', undefined, bob.cookie)).data.tasks.length, 0)
  const exported = await request('/export', 'GET', undefined, alice.cookie)
  assert.equal(exported.data.tasks[0].title, 'Private task')
  assert.match(exported.headers.get('content-disposition'), /attachment/)
  assert.doesNotMatch(JSON.stringify(exported.data), /password_hash|password_salt|token_hash/)
})

test('validation, origin checks, body bounds and JSON API errors', async t => {
  const { request, signup, base } = await fixture(t)
  const { cookie } = await signup()
  for (const invalid of [{ title: ' ' }, { title: 'Invalid status', status: 'invented' }, { title: 'Invalid date', dueDate: '2026-02-30' }, { title: 'Invalid date', dueDate: '0000-01-01' }, { title: 'Too many labels', labels: Array(11).fill('x') }, { title: 'Unknown field', userId: 'stolen' }]) {
    assert.equal((await request('/tasks', 'POST', invalid, cookie)).status, 400)
  }
  assert.equal((await request('/projects', 'POST', { name: 'Bad color', color: 'pink' }, cookie)).status, 400)
  assert.equal((await request('/pages', 'POST', { title: 'Bad blocks', blocks: [{ id: 'same', type: 'text', content: '' }, { id: 'same', type: 'text', content: '' }] }, cookie)).status, 400)
  assert.equal((await request('/projects', 'POST', { name: 'CSRF' }, cookie, { Origin: 'https://untrusted.example' })).status, 403)
  assert.equal((await request('/missing', 'GET', undefined, cookie)).status, 404)
  assert.equal((await request('/tasks', 'GET', undefined, cookie)).status, 405)
  const malformed = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{broken' })
  assert.equal(malformed.status, 400)
  const oversized = await fetch(`${base}/api/pages`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Huge', blocks: [], padding: 'x'.repeat(131072) }) })
  assert.equal(oversized.status, 413)
  const nonJson = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'text/plain' }, body: '{}' })
  assert.equal(nonJson.status, 415)
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404)
  assert.equal((await fetch(`${base}/data/taskflow.db`)).status, 404)
})

test('profile, password changes and invalidation of other sessions', async t => {
  const { request, signup } = await fixture(t)
  const { cookie } = await signup()
  const second = await request('/auth/login', 'POST', { email: 'alex@example.test', password: 'TestPassword!123' })
  const otherCookie = second.headers.get('set-cookie').split(';')[0]
  assert.equal((await request('/profile', 'PATCH', { name: 'Alex Rivera' }, cookie)).data.user.name, 'Alex Rivera')
  assert.equal((await request('/password', 'POST', { currentPassword: 'wrong', newPassword: 'NewPassword!123' }, cookie)).status, 400)
  assert.ok((await request('/session', 'GET', undefined, cookie)).data.user)
  assert.equal((await request('/password', 'POST', { currentPassword: 'TestPassword!123', newPassword: 'NewPassword!123' }, cookie)).status, 200)
  assert.equal((await request('/workspace', 'GET', undefined, otherCookie)).status, 401)
  assert.equal((await request('/workspace', 'GET', undefined, cookie)).status, 200)
  assert.equal((await request('/auth/login', 'POST', { email: 'alex@example.test', password: 'TestPassword!123' })).status, 401)
  assert.equal((await request('/auth/login', 'POST', { email: 'alex@example.test', password: 'NewPassword!123' })).status, 200)
})

test('examples are opt-in, do not overwrite work, and activity remains bounded', async t => {
  const { request, signup } = await fixture(t)
  const { cookie } = await signup()
  const example = await request('/example', 'POST', {}, cookie)
  assert.equal(example.status, 201)
  assert.equal(example.data.projects.length, 3)
  assert.equal(example.data.tasks.length, 12)
  assert.equal(example.data.pages.length, 2)
  assert.equal((await request('/example', 'POST', {}, cookie)).status, 409)
  const task = example.data.tasks[0]
  for (let index = 0; index < 110; index++) assert.equal((await request(`/tasks/${task.id}`, 'PATCH', { title: `Step ${index}` }, cookie)).status, 200)
  assert.equal((await request('/workspace', 'GET', undefined, cookie)).data.activity.length, 30)
})

test('authentication rate limiting stops repeated invalid logins', async t => {
  const { request } = await fixture(t)
  for (let index = 0; index < 20; index++) assert.equal((await request('/auth/login', 'POST', { email: 'missing@example.test', password: 'wrongpassword' })).status, 401)
  const limited = await request('/auth/login', 'POST', { email: 'missing@example.test', password: 'wrongpassword' })
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
})

test('workspace and session survive a real database server restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'taskflow-persist-'))
  const databasePath = join(directory, 'test.db')
  let server = createTaskFlowServer({ databasePath })
  t.after(async () => { if (server.listening) { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)) } await rm(directory, { recursive: true, force: true }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  let base = `http://127.0.0.1:${server.address().port}`
  const signup = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name: 'Persistent User', email: 'persist@example.test', password: 'Password!123' }) })
  const cookie = signup.headers.get('set-cookie').split(';')[0]
  const response = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: JSON.stringify({ title: 'Still here tomorrow' }) })
  assert.equal(response.status, 201)
  server.closeIdleConnections(); await new Promise(resolve => server.close(resolve))
  server = createTaskFlowServer({ databasePath }); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
  const workspace = await fetch(`${base}/api/workspace`, { headers: { Cookie: cookie } })
  assert.equal(workspace.status, 200)
  assert.equal((await workspace.json()).tasks[0].title, 'Still here tomorrow')
})
