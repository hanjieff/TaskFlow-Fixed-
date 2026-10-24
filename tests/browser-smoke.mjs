import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const executable = process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const base = process.env.TASKFLOW_URL || 'http://127.0.0.1:5173'
const profile = await mkdtemp(join(tmpdir(), 'taskflow-browser-'))
const output = join(tmpdir(), 'taskflow-screenshots')
await mkdir(output, { recursive: true })
const browser = spawn(executable, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let socket
let commandId = 0
const pending = new Map()
try {
  const ws = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 20000)
    browser.once('error', error => { clearTimeout(timer); reject(error) })
    browser.stderr.on('data', chunk => {
      const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const endpoint = new URL(ws)
  const targets = await (await fetch(`http://${endpoint.host}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (pending.has(result.id)) {
      const { resolve, reject, timer } = pending.get(result.id)
      clearTimeout(timer)
      pending.delete(result.id)
      if (result.error) reject(new Error(result.error.message))
      else resolve(result.result)
    }
  })
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++commandId
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 20000)
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description || ''))
    return result.result.value
  }
  async function waitFor(expression) {
    return evaluate(`new Promise((resolve,reject)=>{const started=Date.now();function check(){if(${expression})resolve(true);else if(Date.now()-started>10000)reject(new Error('UI did not reach expected state'));else setTimeout(check,50)}check()})`)
  }
  async function screenshot(name) {
    const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const path = join(output, name + '.png'); await writeFile(path, Buffer.from(result.data, 'base64')); console.log('Screenshot:', path)
  }
  await command('Page.enable'); await command('Runtime.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1060, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url: base + '/#/signup' })
  await waitFor(`!!document.querySelector('input[name="email"]')`)
  await screenshot('signup-desktop')
  const email = `browser-${Date.now()}@taskflow.test`
  await evaluate(`(()=>{const fields={name:'Alex Morgan',email:${JSON.stringify(email)},password:'PreviewPassword!123',confirmPassword:'PreviewPassword!123'};for(const [name,value] of Object.entries(fields)){const input=document.querySelector('[name="'+name+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('form').requestSubmit()})()`)
  await waitFor(`!!document.querySelector('.example-banner')`)
  assert.equal(await evaluate(`document.querySelectorAll('.stat-card').length`), 4)
  await evaluate(`document.querySelector('.example-banner button').click()`)
  await waitFor(`document.querySelectorAll('.project-card').length===3`)
  await evaluate(`document.querySelector('.toast button')?.click()`)
  await screenshot('dashboard-desktop')
  assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false)
  await evaluate(`document.querySelector('a[href="#/tasks"]').click()`)
  await waitFor(`!!document.querySelector('.view-tabs')`)
  await screenshot('table-desktop')
  await evaluate(`Array.from(document.querySelectorAll('.view-tabs button')).find(b=>b.textContent.trim()==='Board').click()`)
  await waitFor(`document.querySelectorAll('.board-column').length===4`)
  await screenshot('board-desktop')
  await evaluate(`Array.from(document.querySelectorAll('.view-tabs button')).find(b=>b.textContent.trim()==='Calendar').click()`)
  await waitFor(`document.querySelectorAll('.calendar-day').length===42`)
  await screenshot('calendar-desktop')
  await evaluate(`document.querySelector('a[href="#/pages"]').click()`)
  await waitFor(`!!document.querySelector('.note-editor')`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.note-block--heading input')).fontSize`), '19px')
  await screenshot('pages-desktop')
  await evaluate(`document.querySelector('a[href="#/tasks"]').click()`)
  await waitFor(`!!document.querySelector('.view-tabs')`)
  await evaluate(`Array.from(document.querySelectorAll('.heading-actions button')).find(b=>b.textContent.includes('New task')).click()`)
  await waitFor(`!!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`document.activeElement.name`), 'title')
  await evaluate(`(()=>{const form=document.querySelector('dialog form');const values={title:'Browser workflow check',description:'Saved by the real task editor.',dueDate:'2026-10-22',labels:'Testing, Testing'};for(const [name,value] of Object.entries(values)){const input=form.elements.namedItem(name);const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}form.requestSubmit()})()`)
  await waitFor(`!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`(async()=>{const data=await(await fetch('/api/workspace')).json();return data.tasks.some(t=>t.title==='Browser workflow check'&&t.labels.length===1)})()`), true)
  await evaluate(`(()=>{const input=document.querySelector('#workspace-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Browser workflow check');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await waitFor(`document.querySelector('.task-count')?.textContent==='1 tasks'`)
  await evaluate(`Array.from(document.querySelectorAll('.view-tabs button')).find(b=>b.textContent.trim()==='Table').click()`)
  await waitFor(`document.querySelectorAll('.task-table tbody tr').length===1`)
  await evaluate(`document.querySelector('.task-title-button').click()`)
  await waitFor(`!!document.querySelector('dialog[open]')`)
  await evaluate(`(()=>{const input=document.querySelector('dialog input[name="title"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Browser workflow updated');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('dialog form').requestSubmit()})()`)
  await waitFor(`!document.querySelector('dialog[open]')`)
  await evaluate(`document.querySelector('.filter-summary button').click()`)
  await waitFor(`Array.from(document.querySelectorAll('.task-title-button')).some(b=>b.textContent==='Browser workflow updated')`)
  await evaluate(`Array.from(document.querySelectorAll('.task-title-button')).find(b=>b.textContent==='Browser workflow updated').click()`)
  await waitFor(`!!document.querySelector('dialog[open]')`)
  await evaluate(`window.originalConfirm=window.confirm;window.confirm=()=>true;document.querySelector('.dialog-actions .danger').click()`)
  await waitFor(`!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`(async()=>{const data=await(await fetch('/api/workspace')).json();return data.tasks.some(t=>t.title==='Browser workflow updated')})()`), false)
  await evaluate(`window.confirm=window.originalConfirm;document.querySelector('a[href="#/pages"]').click()`)
  await waitFor(`!!document.querySelector('.note-editor')`)
  await evaluate(`document.querySelector('.page-library .primary').click()`)
  await evaluate(`(()=>{const input=document.querySelector('.note-title-input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Browser notes');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('.add-blocks button')[2].click()})()`)
  await waitFor(`document.querySelectorAll('.note-block').length===2`)
  await evaluate(`(()=>{const input=document.querySelectorAll('.note-block textarea')[1];Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Finish the golden path');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.note-checkbox').click()})()`)
  await evaluate(`window.confirm=()=>false;document.querySelector('a[href="#/tasks"]').click()`)
  assert.equal(await evaluate(`location.hash`), '#/pages')
  await evaluate(`window.confirm=window.originalConfirm;document.querySelector('.note-savebar .primary').click()`)
  await waitFor(`document.querySelector('.note-save-status strong').textContent==='All changes saved'`)
  assert.equal(await evaluate(`(async()=>{const data=await(await fetch('/api/workspace')).json();return data.pages.some(p=>p.title==='Browser notes'&&p.blocks[1].checked)})()`), true)
  await evaluate(`window.confirm=()=>true;document.querySelector('.note-toolbar button').click()`)
  await waitFor(`!Array.from(document.querySelectorAll('.page-list-item')).some(b=>b.textContent.includes('Browser notes'))`)
  await evaluate(`window.confirm=window.originalConfirm;localStorage.clear()`)
  await command('Page.reload')
  await waitFor(`!!document.querySelector('.note-editor')`)
  assert.equal(await evaluate(`document.querySelectorAll('.page-list-item').length`), 2)
  await evaluate(`document.querySelector('a[href="#/settings"]').click()`)
  await waitFor(`!!document.querySelector('.settings-grid')`)
  await evaluate(`document.querySelector('.toggle-switch').click()`)
  assert.equal(await evaluate(`document.documentElement.dataset.theme`), 'dark')
  await waitFor(`Array.from(document.querySelectorAll('.button.secondary')).every(button=>getComputedStyle(button).backgroundColor==='rgb(35, 42, 51)')`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.button.secondary')).color`), 'rgb(245, 245, 245)')
  await screenshot('settings-dark-desktop')
  await evaluate(`document.querySelector('.toggle-switch').click()`)
  await evaluate(`Array.from(document.querySelectorAll('.sidebar-setting')).find(b=>b.textContent.includes('Log out')).click()`)
  await waitFor(`!!document.querySelector('input[name="email"]')`)
  await evaluate(`(()=>{const form=document.querySelector('form');for(const[name,value]of Object.entries({email:${JSON.stringify(email)},password:'incorrectpassword'})){const input=form.elements.namedItem(name);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}form.requestSubmit()})()`)
  await waitFor(`!!document.querySelector('.form-error')`)
  await evaluate(`(()=>{const input=document.querySelector('input[name="password"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'PreviewPassword!123');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form').requestSubmit()})()`)
  await waitFor(`document.querySelectorAll('.project-card').length===3`)
  console.log('Signup, task CRUD/search, page blocks/unsaved guard, persistent session, theme and login workflows passed.')
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate(`window.mobileReloadPending=true`)
  await command('Page.reload')
  await waitFor(`!window.mobileReloadPending && !!document.querySelector('.stats-grid')`)
  await command('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await evaluate(`document.querySelector('.mobile-menu').click();document.querySelector('a[href="#/"]').click()`)
  await waitFor(`!!document.querySelector('.stats-grid') && document.querySelector('.sidebar').getBoundingClientRect().right <= 0`)
  await screenshot('dashboard-mobile')
  assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false)
  assert.equal(await evaluate(`document.querySelector('.workspace-main').getBoundingClientRect().width`), 390)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.mobile-menu')).display`), 'flex')
  await evaluate(`document.querySelector('.mobile-menu').click();document.querySelector('a[href="#/tasks"]').click()`)
  await waitFor(`!!document.querySelector('.view-tabs')`)
  await evaluate(`Array.from(document.querySelectorAll('.view-tabs button')).find(b=>b.textContent.trim()==='Board').click()`)
  await waitFor(`document.querySelectorAll('.board-column').length===4`)
  await screenshot('board-mobile')
  assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false)
  console.log('Desktop and mobile browser smoke checks passed.')
} finally {
  socket?.close()
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser closed')) }
  if (browser.exitCode === null) { browser.kill(); await new Promise(resolve => browser.once('exit', resolve)) }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {})
}
