/**
 * TokenTrace — LLM API Carbon Emissions Estimator
 *
 * Formula:
 *   co2Grams = (inputTokens + 3 * outputTokens) / 1000 * modelKwh * 386
 *
 * Full methodology + citations: tokens-methodology.md
 */

// ─── MODEL ENERGY PROFILES ────────────────────────────────────────────────────
// kWh per 1,000 OUTPUT tokens. More specific keys must come before less specific.
// Matching: case-insensitive prefix or substring.
//
// Sources:
//   Claude Haiku/Opus: carboncredits.com (2025) — directly measured
//   Claude Sonnet: interpolated ~3x Haiku via price ratio proxy
//   GPT-4o: Epoch AI (2025) + OpenAI public disclosure (0.34 Wh/query)
//   GPT-4o-mini: price ratio proxy (~5x cheaper than GPT-4o)
//   GPT-4/turbo: ~2x GPT-4o (older architecture)
//   GPT-3.5: highly optimized, long-deployed
//   Gemini: price-tier proxies only (no published per-token figures)
//   Default: 0.4 J/token modern estimate (clune.org 2025) × 1.2 PUE overhead

const MODEL_KWH_PER_1K = {
  // ── Anthropic Claude ──────────────────────────────────────────────────────
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

  // ── OpenAI GPT ────────────────────────────────────────────────────────────
  'gpt-4o-mini':           0.00012,
  'gpt-4o':                0.00060,
  'gpt-4-turbo':           0.00120,
  'gpt-4':                 0.00120,
  'gpt-3.5-turbo':         0.00020,
  'gpt-3.5':               0.00020,

  // ── OpenAI reasoning models ───────────────────────────────────────────────
  'o3-mini':               0.00060,
  'o3':                    0.00240,
  'o1-mini':               0.00060,
  'o1':                    0.00120,

  // ── Google Gemini ─────────────────────────────────────────────────────────
  'gemini-2.5-pro':        0.00080,
  'gemini-2.0-flash':      0.00010,
  'gemini-1.5-flash':      0.00012,
  'gemini-1.5-pro':        0.00060,

  // ── GPT-5 Codex (OpenAI Codex CLI) ───────────────────────────────────────
  'gpt-5':                 0.00060, // treat as GPT-4o tier until data available

  // ── Fallback ──────────────────────────────────────────────────────────────
  'default':               0.00040,
}

// US EIA national average grid carbon intensity (gCO₂ per kWh)
const GRID_G_CO2_PER_KWH = 386

// ─── MODEL RATE RESOLVER ─────────────────────────────────────────────────────

function getModelKwh(model) {
  if (!model || typeof model !== 'string') return MODEL_KWH_PER_1K['default']
  const lower = model.toLowerCase().trim()
  for (const key of Object.keys(MODEL_KWH_PER_1K)) {
    if (key === 'default') continue
    if (lower.startsWith(key) || lower.includes(key)) return MODEL_KWH_PER_1K[key]
  }
  return MODEL_KWH_PER_1K['default']
}

// ─── CORE ESTIMATION FUNCTION ────────────────────────────────────────────────

function calculateEmissions(model, inputTokens, outputTokens) {
  const modelKwh = getModelKwh(model)

  // Output tokens weighted 3x: sequential autoregressive decode vs parallel prefill.
  // Özcan et al. (2025): decode-heavy workloads draw 2–4x more power than prefill-heavy.
  const weightedTokens = (inputTokens || 0) + 3 * (outputTokens || 0)
  const energyKwh = (weightedTokens / 1000) * modelKwh
  const co2Grams = energyKwh * GRID_G_CO2_PER_KWH

  const comparisons = {
    // EPA: average car emits 0.12 kg CO₂/km → meters
    carMeters: Math.round((co2Grams / 1000 / 0.12) * 1000),
    // US DOE: smartphone charge ≈ 0.011 kg CO₂ → % of charge
    phoneChargePercent: +(co2Grams / 1000 / 0.011 * 100).toFixed(2),
    // EPA: one tree absorbs ~21 kg CO₂/year = ~0.0575 kg/day → tree-days
    treeDaysNeeded: +(co2Grams / 1000 / 0.0575).toFixed(4),
    // 60W bulb at 386 gCO₂/kWh → hours
    lightbulbHours: +(co2Grams / 1000 / 0.0232).toFixed(4),
  }

  return { energyKwh, co2Grams, comparisons, modelKwh }
}

// ─── GREEN ALTERNATIVE SUGGESTER ─────────────────────────────────────────────

function getGreenAlternative(model) {
  if (!model) return null
  const lower = model.toLowerCase()
  const kwh = getModelKwh(model)
  const haikuKwh = MODEL_KWH_PER_1K['claude-haiku']
  const miniKwh = MODEL_KWH_PER_1K['gpt-4o-mini']

  if (lower.includes('claude')) {
    if (kwh <= haikuKwh) return null
    const savingsPct = Math.round((1 - haikuKwh / kwh) * 100)
    return { model: 'claude-haiku', savingsPct }
  }
  if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) {
    if (kwh <= miniKwh) return null
    const savingsPct = Math.round((1 - miniKwh / kwh) * 100)
    return { model: 'gpt-4o-mini', savingsPct }
  }
  return null
}

export { calculateEmissions, getGreenAlternative, getModelKwh }
