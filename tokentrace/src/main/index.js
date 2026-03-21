const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron')
const path = require('path')
const { createProxyServer, setEmitter, PROXY_PORT } = require('./proxy')
const { getStats, getDailyStats, getRecentEvents } = require('./db')

let mainWindow = null
let tray = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../out/renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Hide to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function createTray() {
  // Use a simple template image; replace with real icon in resources/
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)

  const updateMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open TokenTrace', click: () => { mainWindow.show(); mainWindow.focus() } },
      { type: 'separator' },
      { label: `Proxy: localhost:${PROXY_PORT}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuiting = true; app.quit() } }
    ]))
  }

  tray.setToolTip('TokenTrace')
  tray.on('click', () => { mainWindow.show(); mainWindow.focus() })
  updateMenu()
}

function registerIPC() {
  ipcMain.handle('get-stats', (_e, opts) => getStats(opts))
  ipcMain.handle('get-daily', (_e, opts) => getDailyStats(opts))
  ipcMain.handle('get-events', (_e, limit) => getRecentEvents(limit))
  ipcMain.handle('get-proxy-port', () => PROXY_PORT)
  ipcMain.handle('open-external', (_e, url) => shell.openExternal(url))
}

app.whenReady().then(() => {
  createWindow()
  createTray()
  registerIPC()

  // Start proxy; wire emitter so new events push to renderer via IPC
  createProxyServer()
  setEmitter((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage-event', event)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else { mainWindow.show(); mainWindow.focus() }
  })
})

app.on('window-all-closed', () => {
  // Keep app alive in tray on all platforms
})

app.on('before-quit', () => {
  app.isQuiting = true
})
