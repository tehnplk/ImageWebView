import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startServer, stopServer } from './server'
import { openDb, getSetting, setSetting } from './db'
import { scanDocs } from './scan'
import { setupAutoUpdater } from './updater'

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  setupAutoUpdater(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const db = openDb(join(app.getPath('userData'), 'app.db'))
  ipcMain.handle('doc-types', () => db.prepare('SELECT * FROM c_doc_type ORDER BY code').all())

  const typeNames = () =>
    Object.fromEntries(
      db
        .prepare('SELECT code, doc_type_name FROM c_doc_type')
        .all()
        .map((r) => [r.code.toLowerCase(), r.doc_type_name])
    )

  ipcMain.handle('scan-docs', () => [])

  // the scanned root: what Browse last picked, else scanned/ next to the project (dev) or the exe
  const scannedDir = () => {
    const saved = getSetting(db, 'scanned_dir')
    if (saved && existsSync(saved)) return saved
    const base = is.dev ? process.cwd() : dirname(app.getPath('exe'))
    return [join(base, 'scanned'), join(base, '..', 'scanned')].find(existsSync) || ''
  }
  ipcMain.handle('scanned-dir', () => scannedDir())
  ipcMain.handle('pick-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: scannedDir() || undefined
    })
    if (canceled) return null
    setSetting(db, 'scanned_dir', filePaths[0]) // remembered as the scanned root
    return filePaths[0]
  })
  ipcMain.handle('get-auth-url', () => getSetting(db, 'auth_url') || 'http://127.0.0.1:8081')
  ipcMain.handle('set-auth-url', (_e, url) => {
    setSetting(db, 'auth_url', url || 'http://127.0.0.1:8081')
    return true
  })
  ipcMain.handle('test-auth-url', async (_e, url) => {
    try {
      const base = (url || 'http://127.0.0.1:8081').replace(/\/+$/, '')
      const target = base.endsWith('/checkuser') ? base : base + '/checkuser'
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=sa&password=sa',
        signal: AbortSignal.timeout(4000)
      })
      const text = await res.text()
      return { ok: true, msg: `เชื่อมต่อสำเร็จ (HTTP ${res.status}): ${text.slice(0, 80)}` }
    } catch (e) {
      return { ok: false, msg: `เชื่อมต่อไม่สำเร็จ: ${e.message || e}` }
    }
  })
  ipcMain.handle('start-server', (_e, dir, port, authUrl) =>
    startServer(dir, port, typeNames(), authUrl || getSetting(db, 'auth_url') || 'http://127.0.0.1:8081')
  )
  ipcMain.handle('stop-server', () => stopServer())

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('before-quit', () => stopServer())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
