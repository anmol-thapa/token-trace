/**
 * Pure-JS file-based store — no native compilation needed.
 * Stores events as newline-delimited JSON (NDJSON) for fast appends.
 * Reads the full file for queries (fine for hackathon scale).
 */
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

let dbPath = null

function getDbPath() {
  if (!dbPath) dbPath = path.join(app.getPath('userData'), 'tokentrace.ndjson')
  return dbPath
}

function insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, sessionId }) {
  const row = {
    id: Date.now() + Math.random(),
    timestamp: Date.now(),
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    energy_kwh: energyKwh,
    co2_grams: co2Grams,
    session_id: sessionId || null
  }
  fs.appendFileSync(getDbPath(), JSON.stringify(row) + '\n', 'utf8')
  return row
}

function readAll() {
  try {
    const raw = fs.readFileSync(getDbPath(), 'utf8')
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean)
  } catch {
    return []
  }
}

function getStats({ since, provider } = {}) {
  const sinceTs = since ? Date.now() - since : 0
  let rows = readAll().filter((r) => r.timestamp >= sinceTs)
  if (provider) rows = rows.filter((r) => r.provider === provider)

  const totals = rows.reduce(
    (acc, r) => {
      acc.callCount++
      acc.totalInput += r.input_tokens || 0
      acc.totalOutput += r.output_tokens || 0
      acc.totalTokens += r.total_tokens || 0
      acc.totalEnergy += r.energy_kwh || 0
      acc.totalCo2 += r.co2_grams || 0
      return acc
    },
    { callCount: 0, totalInput: 0, totalOutput: 0, totalTokens: 0, totalEnergy: 0, totalCo2: 0 }
  )

  const modelMap = {}
  for (const r of rows) {
    if (!modelMap[r.model]) modelMap[r.model] = { model: r.model, provider: r.provider, calls: 0, tokens: 0, co2: 0 }
    modelMap[r.model].calls++
    modelMap[r.model].tokens += r.total_tokens || 0
    modelMap[r.model].co2 += r.co2_grams || 0
  }
  const byModel = Object.values(modelMap).sort((a, b) => b.co2 - a.co2)

  return { totals, byModel }
}

function getDailyStats({ days = 30 } = {}) {
  const since = Date.now() - days * 86400 * 1000
  const rows = readAll().filter((r) => r.timestamp >= since)

  const dayMap = {}
  for (const r of rows) {
    const day = new Date(r.timestamp).toISOString().slice(0, 10)
    if (!dayMap[day]) dayMap[day] = { day, co2: 0, tokens: 0, calls: 0 }
    dayMap[day].co2 += r.co2_grams || 0
    dayMap[day].tokens += r.total_tokens || 0
    dayMap[day].calls++
  }

  return Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day))
}

function getRecentEvents(limit = 50) {
  return readAll().slice(-limit).reverse()
}

module.exports = { insertEvent, getStats, getDailyStats, getRecentEvents }
