import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import { exec } from 'child_process'
import { createProxyServer, setEmitter, setCompressionEnabled, PROXY_PORT } from './proxy'
import { getStats, getDailyStats, getRecentEvents, insertEvent } from './db'
import { calculateEmissions } from './emissions'

const EXTENSION_PORT = 3002

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')
const CODEX_CONFIG_PATH    = path.join(os.homedir(), '.codex', 'config.toml')
const GEMINI_ENV_PATH      = path.join(os.homedir(), '.env')
const PROXY_URL = `http://localhost:${PROXY_PORT}`

// --- Prefs + PID file (persisted across launches) ---
let PREFS_PATH = null
let PID_PATH = null
const DEFAULT_PREFS = { claudeCode: false, codex: false, gemini: false, compression: false }

function readPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')) } }
  catch { return { ...DEFAULT_PREFS } }
}

function writePrefs(prefs) {
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true })
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2))
}

// --- Claude Code config ---
function readClaudeSettings() {
  try { return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) }
  catch { return {} }
}

function writeClaudeSettings(settings) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2))
}

function applyClaudeCode() {
  const settings = readClaudeSettings()
  settings.env = { ...(settings.env || {}), ANTHROPIC_BASE_URL: PROXY_URL }
  writeClaudeSettings(settings)
}

function removeClaudeCode() {
  const settings = readClaudeSettings()
  if (settings.env) {
    delete settings.env.ANTHROPIC_BASE_URL
    if (Object.keys(settings.env).length === 0) delete settings.env
  }
  writeClaudeSettings(settings)
}

// --- Codex config ---
function getCodexBaseUrl() {
  try {
    const content = fs.readFileSync(CODEX_CONFIG_PATH, 'utf8')
    const match = content.match(/^openai_base_url\s*=\s*"([^"]+)"/m)
    return match ? match[1] : null
  } catch { return null }
}

function applyCodex() {
  fs.mkdirSync(path.dirname(CODEX_CONFIG_PATH), { recursive: true })
  let content = ''
  try { content = fs.readFileSync(CODEX_CONFIG_PATH, 'utf8') } catch { /* new file */ }

  if (/^openai_base_url\s*=/m.test(content)) {
    content = content.replace(/^openai_base_url\s*=.*\n?/m, `openai_base_url = "${PROXY_URL}"\n`)
  } else {
    content = `openai_base_url = "${PROXY_URL}"\n` + (content ? '\n' + content : '')
  }

  if (/^\[shell_environment_policy\.set\]/m.test(content)) {
    if (/^OPENAI_BASE_URL\s*=/m.test(content)) {
      content = content.replace(/^OPENAI_BASE_URL\s*=.*/m, `OPENAI_BASE_URL = "${PROXY_URL}"`)
    } else {
      content = content.replace(
        /^(\[shell_environment_policy\.set\])/m,
        `$1\nOPENAI_BASE_URL = "${PROXY_URL}"`
      )
    }
  }
  fs.writeFileSync(CODEX_CONFIG_PATH, content)
}

// --- Gemini CLI config (~/.env) ---
function getGeminiBaseUrl() {
  try {
    const content = fs.readFileSync(GEMINI_ENV_PATH, 'utf8')
    const match = content.match(/^GEMINI_BASE_URL=(.+)$/m)
    return match ? match[1].trim() : null
  } catch { return null }
}

function applyGemini() {
  let content = ''
  try { content = fs.readFileSync(GEMINI_ENV_PATH, 'utf8') } catch { /* new file */ }
  if (/^GEMINI_BASE_URL=/m.test(content)) {
    content = content.replace(/^GEMINI_BASE_URL=.*/m, `GEMINI_BASE_URL=${PROXY_URL}`)
  } else {
    content = content.trimEnd() + (content ? '\n' : '') + `GEMINI_BASE_URL=${PROXY_URL}\n`
  }
  fs.writeFileSync(GEMINI_ENV_PATH, content)
}

function removeGemini() {
  try {
    let content = fs.readFileSync(GEMINI_ENV_PATH, 'utf8')
    content = content.replace(/^GEMINI_BASE_URL=.*\n?/m, '')
    fs.writeFileSync(GEMINI_ENV_PATH, content)
  } catch { /* file doesn't exist */ }
}

function removeCodex() {
  try {
    let content = fs.readFileSync(CODEX_CONFIG_PATH, 'utf8')
    content = content.replace(/^openai_base_url\s*=.*\n?/m, '')
    content = content.replace(/^OPENAI_BASE_URL\s*=.*\n?/m, '')
    fs.writeFileSync(CODEX_CONFIG_PATH, content)
  } catch { /* file doesn't exist */ }
}

let mainWindow = null
let tray = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#052e16',
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

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open TokenTrace', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: `Proxy: localhost:${PROXY_PORT}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit() } }
  ]))
  tray.setToolTip('TokenTrace')
  tray.on('click', () => { mainWindow.show(); mainWindow.focus() })
}

function registerIPC() {
  ipcMain.handle('get-stats', (_e, opts) => getStats(opts))
  ipcMain.handle('get-daily', (_e, opts) => getDailyStats(opts))
  ipcMain.handle('get-events', (_e, limit) => getRecentEvents(limit))
  ipcMain.handle('get-proxy-port', () => PROXY_PORT)
  ipcMain.handle('open-external', (_e, url) => shell.openExternal(url))

  // Connection status
  ipcMain.handle('get-connection-status', () => {
    const settings = readClaudeSettings()
    const connected = settings?.env?.ANTHROPIC_BASE_URL === PROXY_URL
    return { connected, currentValue: settings?.env?.ANTHROPIC_BASE_URL ?? null }
  })
  ipcMain.handle('get-codex-status', () => {
    const current = getCodexBaseUrl()
    return { connected: current === PROXY_URL, currentValue: current }
  })

  // Connect / disconnect (also saves pref so app auto-reconnects on next launch)
  ipcMain.handle('connect-claude-code', () => {
    applyClaudeCode()
    const prefs = readPrefs(); prefs.claudeCode = true; writePrefs(prefs)
    return { ok: true }
  })
  ipcMain.handle('disconnect-claude-code', () => {
    removeClaudeCode()
    const prefs = readPrefs(); prefs.claudeCode = false; writePrefs(prefs)
    return { ok: true }
  })
  ipcMain.handle('connect-codex', () => {
    applyCodex()
    const prefs = readPrefs(); prefs.codex = true; writePrefs(prefs)
    return { ok: true }
  })
  ipcMain.handle('disconnect-codex', () => {
    removeCodex()
    const prefs = readPrefs(); prefs.codex = false; writePrefs(prefs)
    return { ok: true }
  })

  ipcMain.handle('get-gemini-status', () => {
    const current = getGeminiBaseUrl()
    return { connected: current === PROXY_URL, currentValue: current }
  })
  ipcMain.handle('connect-gemini', () => {
    applyGemini()
    const prefs = readPrefs(); prefs.gemini = true; writePrefs(prefs)
    return { ok: true }
  })
  ipcMain.handle('disconnect-gemini', () => {
    removeGemini()
    const prefs = readPrefs(); prefs.gemini = false; writePrefs(prefs)
    return { ok: true }
  })

  // Restart helpers
  ipcMain.handle('restart-claude-code', () =>
    new Promise((resolve) => exec('pkill -f "claude"', () => resolve({ ok: true })))
  )
  ipcMain.handle('restart-codex', () =>
    new Promise((resolve) => exec('pkill -f "codex"', () => resolve({ ok: true })))
  )
  ipcMain.handle('restart-gemini', () =>
    new Promise((resolve) => exec('pkill -f "gemini"', () => resolve({ ok: true })))
  )

  ipcMain.handle('get-prefs', () => readPrefs())

  ipcMain.handle('get-compression-enabled', () => readPrefs().compression)
  ipcMain.handle('set-compression-enabled', (_e, val) => {
    setCompressionEnabled(val)
    const prefs = readPrefs(); prefs.compression = val; writePrefs(prefs)
    return { ok: true }
  })
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

// ── Extension receiver ────────────────────────────────────────────────────────
// Listens on port 3002 for POST /event from the browser extension.
// Accepts { provider, model, inputTokens, outputTokens } and feeds the event
// into the same pipeline as proxy traffic (NDJSON log + renderer live update).
function startExtensionReceiver(emitFn) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    if (req.method === 'POST' && req.url === '/event') {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        try {
          const { provider, model, inputTokens, outputTokens } = JSON.parse(body)
          if (inputTokens || outputTokens) {
            const { energyKwh, co2Grams, comparisons } = calculateEmissions(model, inputTokens, outputTokens)
            insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams })
            if (emitFn) {
              emitFn({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, comparisons, timestamp: Date.now() })
            }
          }
          res.writeHead(200); res.end('ok')
        } catch (_) { res.writeHead(400); res.end('bad request') }
      })
      return
    }

    res.writeHead(404); res.end()
  })

  server.listen(EXTENSION_PORT, '127.0.0.1', () => {
    console.log(`[tokentrace] extension receiver on http://127.0.0.1:${EXTENSION_PORT}`)
  })
  return server
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  PREFS_PATH = path.join(userData, 'connection-prefs.json')
  PID_PATH = path.join(userData, 'app.pid')

  // Crash recovery: if a stale PID file exists and that process is dead,
  // the app was force-killed last time — clean up any leftover proxy URLs
  try {
    const oldPid = parseInt(fs.readFileSync(PID_PATH, 'utf8'))
    if (!isProcessAlive(oldPid)) {
      removeClaudeCode()
      removeCodex()
      removeGemini()
    }
  } catch { /* no PID file = clean first launch */ }

  // Write current PID so we can detect crashes on next launch
  fs.writeFileSync(PID_PATH, String(process.pid))

  createWindow()
  createTray()
  registerIPC()

  // Auto-reconnect: re-apply proxy URLs for tools that were connected last session
  const prefs = readPrefs()
  if (prefs.claudeCode) { applyClaudeCode(); exec('pkill -f "claude"') }
  if (prefs.codex) { applyCodex() }
  if (prefs.gemini) { applyGemini() }
  if (prefs.compression) { setCompressionEnabled(true) }

  const emitUsageEvent = (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usage-event', event)
    }
    if (event.compressionStats && Notification.isSupported()) {
      const { originalChars, compressedChars } = event.compressionStats
      const pct  = Math.round((1 - compressedChars / originalChars) * 100)
      const saved = Math.ceil(originalChars / 4) - Math.ceil(compressedChars / 4)
      new Notification({
        title: '🌱 Prompt Compressed',
        body: `↓${pct}% reduction · ~${saved} tokens saved`,
        silent: true
      }).show()
    }
  }

  createProxyServer()
  setEmitter(emitUsageEvent)
  startExtensionReceiver(emitUsageEvent)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else { mainWindow.show(); mainWindow.focus() }
  })
})

app.on('window-all-closed', () => {
  // Keep alive in tray
})

function cleanup() {
  removeClaudeCode()
  removeCodex()
  removeGemini()
  try { if (PID_PATH) fs.unlinkSync(PID_PATH) } catch { /* ignore */ }
}

app.on('before-quit', () => {
  app.isQuiting = true
  cleanup()
  const prefs = readPrefs()
  if (prefs.claudeCode) exec('pkill -f "claude"')
})

// Last-resort: fires even on SIGTERM / force kill
process.on('exit', cleanup)
