import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  docTypes: () => ipcRenderer.invoke('doc-types'),
  scanDocs: (dir) => ipcRenderer.invoke('scan-docs', dir),
  scannedDir: () => ipcRenderer.invoke('scanned-dir'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  getAuthUrl: () => ipcRenderer.invoke('get-auth-url'),
  setAuthUrl: (url) => ipcRenderer.invoke('set-auth-url', url),
  testAuthUrl: (url) => ipcRenderer.invoke('test-auth-url', url),
  startServer: (dir, port, authUrl) => ipcRenderer.invoke('start-server', dir, port, authUrl),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  serverState: () => ipcRenderer.invoke('server-state'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    const cb = (_e, val) => callback(val)
    ipcRenderer.on('update-status', cb)
    return () => ipcRenderer.removeListener('update-status', cb)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
