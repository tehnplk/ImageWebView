import { app, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

const SIX_HOURS = 6 * 60 * 60 * 1000

export function setupAutoUpdater(mainWindow) {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  const send = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    send('update-status', { state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    send('update-status', {
      state: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    send('update-status', {
      state: 'not-available',
      version: info.version
    })
  })

  autoUpdater.on('error', async (err) => {
    // If running in development or not packaged, fallback to checking GitHub releases directly
    if (!app.isPackaged) {
      try {
        const res = await fetch('https://api.github.com/repos/tehnplk/ImageWebView/releases/latest', {
          headers: { 'User-Agent': 'ImageWebView-Updater' }
        })
        if (res.ok) {
          const release = await res.json()
          const latestVer = release.tag_name ? release.tag_name.replace(/^v/, '') : release.name
          const currentVer = app.getVersion()
          if (latestVer && isNewer(latestVer, currentVer)) {
            send('update-status', {
              state: 'available',
              version: latestVer,
              releaseDate: release.published_at,
              htmlUrl: release.html_url
            })
            return
          }
        }
      } catch {}
    }
    send('update-status', {
      state: 'error',
      error: err?.message || String(err)
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    send('update-status', {
      state: 'downloading',
      percent: Math.round(progress.percent || 0),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('update-status', {
      state: 'downloaded',
      version: info.version
    })
  })

  async function check() {
    try {
      if (app.isPackaged) {
        await autoUpdater.checkForUpdates()
      } else {
        // In dev environment, check GitHub Releases API
        const res = await fetch('https://api.github.com/repos/tehnplk/ImageWebView/releases/latest', {
          headers: { 'User-Agent': 'ImageWebView-Updater' }
        })
        if (res.ok) {
          const release = await res.json()
          const latestVer = (release.tag_name || release.name || '').replace(/^v/, '')
          const currentVer = app.getVersion()
          if (latestVer && isNewer(latestVer, currentVer)) {
            send('update-status', {
              state: 'available',
              version: latestVer,
              releaseDate: release.published_at,
              htmlUrl: release.html_url
            })
          } else {
            send('update-status', { state: 'not-available', version: currentVer })
          }
        } else {
          send('update-status', { state: 'not-available', version: app.getVersion() })
        }
      }
    } catch (e) {
      send('update-status', { state: 'error', error: e.message || String(e) })
    }
  }

  // 1. Check on every application launch (3 seconds after start)
  setTimeout(() => {
    check()
  }, 3000)

  // 2. Check every 6 hours
  const intervalTimer = setInterval(() => {
    check()
  }, SIX_HOURS)

  app.on('before-quit', () => {
    clearInterval(intervalTimer)
  })

  // IPC Handlers
  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('check-for-updates', async () => {
    await check()
    return true
  })

  ipcMain.handle('download-update', async () => {
    if (app.isPackaged) {
      return autoUpdater.downloadUpdate()
    } else {
      // In dev, open the release page
      const { shell } = await import('electron')
      shell.openExternal('https://github.com/tehnplk/ImageWebView/releases/latest')
      return true
    }
  })

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

function isNewer(latest, current) {
  const pLatest = latest.replace(/^v/, '').split('.').map(Number)
  const pCurrent = current.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pLatest.length, pCurrent.length); i++) {
    const l = pLatest[i] || 0
    const c = pCurrent[i] || 0
    if (l > c) return true
    if (l < c) return false
  }
  return false
}

