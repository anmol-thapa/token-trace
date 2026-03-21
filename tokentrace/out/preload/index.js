"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("api", {
  getStats: (opts) => ipcRenderer.invoke("get-stats", opts),
  getDaily: (opts) => ipcRenderer.invoke("get-daily", opts),
  getEvents: (limit) => ipcRenderer.invoke("get-events", limit),
  getProxyPort: () => ipcRenderer.invoke("get-proxy-port"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onUsageEvent: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("usage-event", handler);
    return () => ipcRenderer.removeListener("usage-event", handler);
  },
  getConnectionStatus: () => ipcRenderer.invoke("get-connection-status"),
  connectClaudeCode: () => ipcRenderer.invoke("connect-claude-code"),
  disconnectClaudeCode: () => ipcRenderer.invoke("disconnect-claude-code"),
  restartClaudeCode: () => ipcRenderer.invoke("restart-claude-code"),
  getCodexStatus: () => ipcRenderer.invoke("get-codex-status"),
  connectCodex: () => ipcRenderer.invoke("connect-codex"),
  disconnectCodex: () => ipcRenderer.invoke("disconnect-codex"),
  restartCodex: () => ipcRenderer.invoke("restart-codex"),
  getPrefs: () => ipcRenderer.invoke("get-prefs")
});
