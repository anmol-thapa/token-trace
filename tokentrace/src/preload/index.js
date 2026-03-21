const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getStats: (opts) => ipcRenderer.invoke('get-stats', opts),
  getDaily: (opts) => ipcRenderer.invoke('get-daily', opts),
  getEvents: (limit) => ipcRenderer.invoke('get-events', limit),
  getProxyPort: () => ipcRenderer.invoke('get-proxy-port'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onUsageEvent: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('usage-event', handler)
    return () => ipcRenderer.removeListener('usage-event', handler)
  }
})
