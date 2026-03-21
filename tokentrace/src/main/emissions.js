// Energy estimates in kWh per 1K tokens
// Sources: Patterson et al. 2021, Luccioni et al. 2023
const MODEL_PROFILES = [
  // Anthropic
  { prefix: 'claude-opus', kwh: 0.0040 },
  { prefix: 'claude-sonnet', kwh: 0.0015 },
  { prefix: 'claude-haiku', kwh: 0.0003 },
  { prefix: 'claude-3-opus', kwh: 0.0040 },
  { prefix: 'claude-3-5-sonnet', kwh: 0.0015 },
  { prefix: 'claude-3-5-haiku', kwh: 0.0003 },
  { prefix: 'claude-3-sonnet', kwh: 0.0015 },
  { prefix: 'claude-3-haiku', kwh: 0.0003 },
  // OpenAI
  { prefix: 'o3', kwh: 0.0080 },
  { prefix: 'o1', kwh: 0.0040 },
  { prefix: 'gpt-4o-mini', kwh: 0.0003 },
  { prefix: 'gpt-4o', kwh: 0.0015 },
  { prefix: 'gpt-4', kwh: 0.0040 },
  { prefix: 'gpt-3.5', kwh: 0.0003 }
]

// US average grid carbon intensity (EPA 2023): 386 gCO₂/kWh
const GRID_INTENSITY_G_PER_KWH = 386

function getModelKwh(model) {
  if (!model) return 0.0010
  const lower = model.toLowerCase()
  for (const profile of MODEL_PROFILES) {
    if (lower.startsWith(profile.prefix)) return profile.kwh
  }
  return 0.0010 // default
}

function calculateEmissions(model, inputTokens, outputTokens) {
  const modelKwh = getModelKwh(model)

  // Output tokens cost ~3x more (generation vs prefill)
  const weightedTokens = inputTokens + outputTokens * 3
  const energyKwh = (weightedTokens / 1000) * modelKwh
  const co2Grams = energyKwh * GRID_INTENSITY_G_PER_KWH

  const comparisons = {
    // meters driven in an average car (~120 gCO₂/km)
    carMeters: Math.round((co2Grams / 120) * 1000),
    // phone charge percentage points (~0.05 gCO₂/%)
    phoneChargePercent: Math.round(co2Grams / 0.05),
    // seconds of HD video streaming (~0.017 gCO₂/s)
    videoSeconds: Math.round(co2Grams * 60),
    // seconds for one tree to absorb this CO₂ (~57.5 g/day)
    treeSeconds: Math.round((co2Grams / 57.5) * 86400)
  }

  return { energyKwh, co2Grams, comparisons, modelKwh }
}

// Return the cheaper/greener alternative for a given model
function getGreenAlternative(model) {
  if (!model) return null
  const lower = model.toLowerCase()
  if (lower.includes('opus') || lower.includes('gpt-4') && !lower.includes('mini')) {
    if (lower.includes('claude')) return { model: 'claude-haiku', savingsPct: 87 }
    return { model: 'gpt-4o-mini', savingsPct: 87 }
  }
  if (lower.includes('sonnet') || lower.includes('gpt-4o')) {
    if (lower.includes('claude')) return { model: 'claude-haiku', savingsPct: 80 }
    return { model: 'gpt-4o-mini', savingsPct: 80 }
  }
  return null
}

module.exports = { calculateEmissions, getGreenAlternative, getModelKwh }
