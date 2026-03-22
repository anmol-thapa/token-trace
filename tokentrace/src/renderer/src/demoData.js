// Canned demo datasets for presentation mode.
// Each dataset: events[], stats{ totals{} }, daily[]

const today = new Date()
today.setHours(0, 0, 0, 0)
const dayMs = 86400000

// Returns a timestamp for today at a given hour:minute
function t(hour, min = 0, daysAgo = 0) {
  return today.getTime() - daysAgo * dayMs + hour * 3600000 + min * 60000
}

function ev(model, input, output, provider = 'anthropic', compressionStats = null, timestamp = Date.now()) {
  const kwhPer1k =
    model.includes('haiku')     ? 0.00055 :
    model.includes('sonnet')    ? 0.00160 :
    model.includes('opus')      ? 0.01013 :
    model.includes('4o-mini')   ? 0.00043 :
    model.includes('gpt-4o')    ? 0.00290 : 0.00160
  const co2 = (input + output * 3) / 1000 * kwhPer1k * 386
  return {
    id: Math.random(),
    timestamp,
    provider,
    model,
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    co2_grams: parseFloat(co2.toFixed(6)),
    energy_kwh: parseFloat((co2 / 386).toFixed(8)),
    compressionStats,
  }
}

function cs(orig, comp, origText = '', compText = '') {
  return { originalChars: orig, compressedChars: comp, originalText: origText, compressedText: compText }
}

function makeTotals(events) {
  return {
    callCount:   events.length,
    totalInput:  events.reduce((s, e) => s + e.input_tokens, 0),
    totalOutput: events.reduce((s, e) => s + e.output_tokens, 0),
    totalCo2:    parseFloat(events.reduce((s, e) => s + e.co2_grams, 0).toFixed(4)),
    totalEnergy: parseFloat(events.reduce((s, e) => s + e.energy_kwh, 0).toFixed(8)),
  }
}

function makeDaily(baseTokensPerDay, baseCo2PerDay, daysBack = 7) {
  const days = []
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * dayMs)
    const jitter = 0.6 + Math.random() * 0.8
    const tokens = Math.floor(baseTokensPerDay * jitter)
    const co2 = parseFloat((baseCo2PerDay * jitter).toFixed(3))
    days.push({
      date: d.toISOString().slice(0, 10),
      co2,
      tokens,
      requests: Math.floor(tokens / 350),
    })
  }
  return days
}

// ── Dataset 1: Heavy Claude Code session with compression ─────────────────────
const ORIG_TEXT = `Hi, so I've been staring at this app.py file for way too long and I know there are probably a bunch of problems with it but I'm not sure where to even start. The main thing I'm worried about is that the app keeps crashing after running for a few hours in production and I'm pretty sure it's something to do with database connections not being cleaned up properly, especially in the Celery tasks. But also honestly looking at it now I feel like there might be other issues too — like maybe some of the endpoints aren't handling errors properly or something could go wrong if the request data is missing fields. If you could go through the file and fix the connection leak issues in the Celery tasks first since that's the most urgent thing, and then also add proper error handling to the endpoints that are missing it, and point out anything else that looks obviously wrong, that would be super helpful.`
const COMP_TEXT = `Review app.py for:\n1. Database connection leaks in Celery tasks (priority fix)\n2. Add error handling to endpoints for missing request fields\n3. Flag other obvious issues\n\nProvide the fixed file.`

const DARK_ORIG = `Hey so I was thinking, like, it would be really cool if we could maybe add some kind of dark mode to the dashboard? I know it's not super urgent or anything and there are probably more important things to work on, but honestly I find it a little hard on the eyes sometimes especially late at night. I was wondering if you could maybe just add a toggle somewhere, like in the settings or maybe in the top right corner of the nav, that lets users switch between light and dark themes. Nothing too fancy, just enough to make it easier to look at. Let me know what you think or if it's too much work right now, totally understand if it has to wait.`
const DARK_COMP = `Add dark mode toggle to dashboard (top-right nav preferred). Light/dark theme switch, minimal implementation.`

const D1_EVENTS = [
  ev('claude-sonnet-4-6',        226,  89, 'anthropic', cs(904, 204, ORIG_TEXT, COMP_TEXT), t(9, 4)),
  ev('claude-haiku-4-5-20251001', 410, 180, 'anthropic', null,                               t(9, 5)),
  ev('claude-sonnet-4-6',       1858, 312, 'anthropic', null,                               t(9, 22)),
  ev('claude-sonnet-4-6',        148,  64, 'anthropic', cs(720, 160, DARK_ORIG, DARK_COMP), t(10, 11)),
  ev('claude-haiku-4-5-20251001', 545, 210, 'anthropic', null,                               t(10, 12)),
  ev('claude-sonnet-4-6',       2241, 489, 'anthropic', null,                               t(11, 35)),
  ev('claude-sonnet-4-6',       1395, 267, 'anthropic', null,                               t(13, 8)),
  ev('claude-haiku-4-5-20251001', 280,  95, 'anthropic', null,                               t(13, 9)),
  ev('claude-sonnet-4-6',        310,  98, 'anthropic', null,                               t(14, 47)),
  ev('claude-sonnet-4-6',       3102, 612, 'anthropic', null,                               t(15, 20)),
  ev('claude-haiku-4-5-20251001', 390, 140, 'anthropic', null,                               t(15, 21)),
  ev('claude-sonnet-4-6',        820, 204, 'anthropic', null,                               t(16, 33)),
]

export const DEMO_DATASETS = [
  {
    id: 'demo-1',
    label: 'Claude Code Session',
    events: D1_EVENTS,
    stats: { totals: makeTotals(D1_EVENTS) },
    daily: makeDaily(12000, 5.8),
  },

  // ── Dataset 2: Multi-provider session ────────────────────────────────────────
  (() => {
    const events = [
      ev('claude-sonnet-4-6',        890, 210, 'anthropic', cs(812, 190, ORIG_TEXT, COMP_TEXT), t(9, 15)),
      ev('gpt-4o',                  1240, 380, 'openai',    null,                               t(9, 48)),
      ev('claude-sonnet-4-6',       2100, 490, 'anthropic', null,                               t(10, 22)),
      ev('gpt-4o-mini',              640, 190, 'openai',    null,                               t(10, 55)),
      ev('claude-haiku-4-5-20251001', 380, 120, 'anthropic', null,                              t(11, 10)),
      ev('gpt-4o',                   980, 280, 'openai',    cs(680, 155, DARK_ORIG, DARK_COMP), t(12, 5)),
      ev('claude-sonnet-4-6',       1650, 340, 'anthropic', null,                               t(13, 30)),
      ev('gpt-4o-mini',              420, 140, 'openai',    null,                               t(14, 18)),
      ev('claude-opus-4-6',         2800, 620, 'anthropic', null,                               t(15, 0)),
      ev('claude-sonnet-4-6',        310,  98, 'anthropic', null,                               t(16, 42)),
      ev('gpt-4o',                   760, 230, 'openai',    null,                               t(17, 5)),
    ]
    return {
      id: 'demo-2',
      label: 'Multi-Provider Session',
      events,
      stats: { totals: makeTotals(events) },
      daily: makeDaily(18000, 9.2),
    }
  })(),

  // ── Dataset 3: Compression showcase ──────────────────────────────────────────
  (() => {
    const hours = [9, 9, 10, 10, 11, 11, 13, 13, 14, 14, 15, 15]
    const mins  = [5, 35, 10, 50, 20, 55, 15, 45, 0,  30, 10, 50]
    const events = hours.map((h, i) => {
      const compressed = i % 2 === 0
      return ev(
        i % 3 === 2 ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6',
        compressed ? 101 + Math.floor(i * 7) : 226 + Math.floor(i * 12),
        80 + Math.floor(i * 8),
        'anthropic',
        compressed ? cs(904, 204, ORIG_TEXT, COMP_TEXT) : null,
        t(h, mins[i])
      )
    })
    return {
      id: 'demo-3',
      label: 'Compression Showcase',
      events,
      stats: { totals: makeTotals(events) },
      daily: makeDaily(8000, 3.4),
    }
  })(),
]
