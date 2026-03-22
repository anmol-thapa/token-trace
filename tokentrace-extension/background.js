'use strict'

// ── Emissions math (mirrors tokentrace/src/main/emissions.js) ──────────────────
// kWh per 1,000 OUTPUT tokens — more specific keys must come first.
const MODEL_KWH_PER_1K = {
  // Anthropic Claude
  'claude-haiku-4':        0.00055,
  'claude-3-5-haiku':      0.00055,
  'claude-3-haiku':        0.00055,
  'claude-haiku':          0.00055,

  'claude-sonnet-4':       0.00160,
  'claude-3-7-sonnet':     0.00160,
  'claude-3-5-sonnet':     0.00160,
  'claude-3-sonnet':       0.00160,
  'claude-sonnet':         0.00160,

  'claude-opus-4':         0.01013,
  'claude-3-opus':         0.01013,
  'claude-opus':           0.01013,

  // OpenAI GPT
  'gpt-4o-mini':           0.00012,
  'gpt-4o':                0.00060,
  'gpt-4-turbo':           0.00120,
  'gpt-4':                 0.00120,
  'gpt-3.5-turbo':         0.00020,
  'gpt-3.5':               0.00020,

  // OpenAI reasoning
  'o3-mini':               0.00060,
  'o3':                    0.00240,
  'o1-mini':               0.00060,
  'o1':                    0.00120,

  'default':               0.00040,
}

const GRID_G_CO2_PER_KWH = 386  // US EIA national average

function getModelKwh(model) {
  if (!model) return MODEL_KWH_PER_1K['default']
  const lower = model.toLowerCase().trim()
  for (const [key, kwh] of Object.entries(MODEL_KWH_PER_1K)) {
    if (key === 'default') continue
    if (lower.startsWith(key) || lower.includes(key)) return kwh
  }
  return MODEL_KWH_PER_1K['default']
}

function calculateEmissions(model, inputTokens, outputTokens) {
  const modelKwh = getModelKwh(model)
  // Output weighted 3× — autoregressive decode is sequential vs parallel prefill
  const weightedTokens = (inputTokens || 0) + 3 * (outputTokens || 0)
  const energyKwh = (weightedTokens / 1000) * modelKwh
  const co2Grams = energyKwh * GRID_G_CO2_PER_KWH
  return { co2Grams, energyKwh }
}

// ── Electron app integration ────────────────────────────────────────────────────
// When the TokenTrace desktop app is running it listens on port 3002.
// If it's not running, the fetch fails silently and data is only stored locally.
const ELECTRON_PORT = 3002

async function sendToElectron(payload) {
  try {
    await fetch(`http://localhost:${ELECTRON_PORT}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    })
  } catch (_) {
    // Desktop app not running — data saved to local storage only
  }
}

// ── Local storage ───────────────────────────────────────────────────────────────
async function persistLocally(provider, model, inputTokens, outputTokens, co2Grams) {
  const stored = (await chrome.storage.local.get('totals')).totals || {
    co2Grams: 0,
    inputTokens: 0,
    outputTokens: 0,
    queries: 0,
    since: Date.now(),
  }
  stored.co2Grams    += co2Grams
  stored.inputTokens += inputTokens
  stored.outputTokens += outputTokens
  stored.queries++
  await chrome.storage.local.set({ totals: stored })
}

// ── Message handler ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'usage') return false

  const { provider, model, inputTokens, outputTokens } = msg
  const { co2Grams, energyKwh } = calculateEmissions(model, inputTokens, outputTokens)

  // Reply to content script immediately (synchronous) so badge can render
  sendResponse({ co2Grams, energyKwh, inputTokens, outputTokens, model })

  // Fire-and-forget background work
  sendToElectron({ provider, model, inputTokens, outputTokens, source: 'extension' })
  persistLocally(provider, model, inputTokens, outputTokens, co2Grams)

  return false
})
