import { app, BrowserWindow, Menu, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.TASKFLOW_URL || 'http://127.0.0.1:3001'
const APP_ORIGIN = new URL(APP_URL).origin
const VERSION = '0.1.0'

const isAppUrl = (url) => {
  try { return new URL(url).origin === APP_ORIGIN || url.startsWith('file://') } catch { return false }
}

let win = null

function showOffline(reason) {
  console.log(`[taskflow-desktop] cannot reach ${APP_URL} (${reason}); showing offline screen`)
  win.loadFile(join(here, 'offline.html'), { query: { url: APP_URL, reason } })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#30475E',
    title: 'TaskFlow',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} TaskFlowDesktop/${VERSION}`)
  win.webContents.on('did-finish-load', () => console.log(`[taskflow-desktop] loaded ${win.webContents.getURL()}`))
  win.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (isMainFrame && !url.startsWith('file://')) showOffline(description)
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/u.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.on('closed', () => { win = null })
  win.loadURL(APP_URL).catch(() => {})
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  Menu.setApplicationMenu(null)
  app.whenReady().then(createWindow)
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.on('window-all-closed', () => app.quit())
}
