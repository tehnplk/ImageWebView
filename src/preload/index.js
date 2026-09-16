import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  docTypes: () => ipcRenderer.invoke('doc-types'),
  scanDocs: (dir) => ipcRenderer.invoke('scan-docs', dir),
  scannedDir: () => ipcRenderer.invoke('scanned-dir'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  startServer: (dir, port) => ipcRenderer.invoke('start-server', dir, port),
  stopServer: () => ipcRenderer.invoke('stop-server')
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
