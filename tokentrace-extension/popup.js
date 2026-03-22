'use strict'

const ELECTRON_PORT = 3002

function formatCO2(grams) {
  if (!grams) return '0 mg'
  if (grams >= 1)      return `${grams.toFixed(2)} g`
  if (grams >= 0.001)  return `${(grams * 1000).toFixed(1)} mg`
  return `${(grams * 1_000_000).toFixed(1)} µg`
}

function formatTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatSince(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Electron ping ────────────────────────────────────────────────────────────
async function checkElectron() {
  try {
    const res = await fetch(`http://localhost:${ELECTRON_PORT}/event`, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(1500),
    })
    return res.status === 204
  } catch (_) {
    return false
  }
}

// ── Active tab detection ─────────────────────────────────────────────────────
async function getActiveTabHost() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url || ''
      if (url.includes('claude.ai'))                              resolve('claude')
      else if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) resolve('chatgpt')
      else                                                        resolve(null)
    })
  })
}

// ── Render ───────────────────────────────────────────────────────────────────
async function render() {
  const [connected, totals, activeHost] = await Promise.all([
    checkElectron(),
    chrome.storage.local.get('totals').then(r => r.totals || null),
    getActiveTabHost(),
  ])

  // Desktop connection
  const dot   = document.getElementById('app-dot')
  const label = document.getElementById('app-label')
  const port  = document.getElementById('app-port')

  if (connected) {
    dot.className   = 'dot dot-green'
    label.textContent = 'Connected'
    label.className   = 'connection-label'
    port.className    = 'port-badge'
  } else {
    dot.className   = 'dot dot-gray'
    label.textContent = 'Desktop app not running'
    label.className   = 'connection-label dim'
    port.className    = 'port-badge dim'
  }

  // Stats
  document.getElementById('stat-tokens').textContent  = formatTokens((totals?.inputTokens || 0) + (totals?.outputTokens || 0))
  document.getElementById('stat-co2').textContent     = formatCO2(totals?.co2Grams)
  document.getElementById('stat-queries').textContent = totals?.queries ?? 0
  document.getElementById('stat-since').textContent   = formatSince(totals?.since)

  // Site chips
  const chipClaude  = document.getElementById('chip-claude')
  const chipChatGPT = document.getElementById('chip-chatgpt')

  if (activeHost === 'claude') {
    chipClaude.className = 'site-chip active'
    chipClaude.querySelector('.dot').className = 'dot dot-green'
  }
  if (activeHost === 'chatgpt') {
    chipChatGPT.className = 'site-chip active'
    chipChatGPT.querySelector('.dot').className = 'dot dot-green'
  }
}

render()
