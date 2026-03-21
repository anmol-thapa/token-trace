// All formulas match tokens-methodology.md (EPA / US DOE sources)
export default function ComparisonCard({ stats }) {
  const co2g = stats?.totals?.totalCo2 || 0
  const co2kg = co2g / 1000

  // EPA: avg car emits 0.12 kg CO₂/km → meters driven
  const carMeters = co2kg / 0.12 * 1000
  // US DOE: smartphone charge ≈ 0.011 kg CO₂ → % of charge
  const phonePercent = co2kg / 0.011 * 100
  // EPA: one tree absorbs ~21 kg CO₂/year = 0.0575 kg/day
  const treeDays = co2kg / 0.0575
  // 60W bulb at 386 gCO₂/kWh: 0.06 kWh/hr × 386 = 23.2 g/hr = 0.0232 kg/hr
  const bulbHours = co2kg / 0.0232

  const rows = [
    { emoji: '🚗', label: 'Driving', value: carMeters >= 1000 ? `${(carMeters / 1000).toFixed(2)} km` : `${Math.round(carMeters)} m` },
    { emoji: '📱', label: 'Phone charge', value: `${phonePercent.toFixed(1)}%` },
    { emoji: '🌳', label: 'Tree absorbs in', value: fmtDays(treeDays) },
    { emoji: '💡', label: 'Lightbulb', value: fmtHours(bulbHours) },
  ]

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
        Impact = …
      </h2>
      <ul className="space-y-2">
        {rows.map(({ emoji, label, value }) => (
          <li key={label} className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{emoji} {label}</span>
            <span className="font-semibold text-white">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function fmtDays(d) {
  if (d < 1 / 24) return `${Math.round(d * 24 * 60)} min`
  if (d < 1) return `${(d * 24).toFixed(1)} hr`
  return `${d.toFixed(1)} days`
}

function fmtHours(h) {
  if (h < 1 / 60) return `${Math.round(h * 3600)} sec`
  if (h < 1) return `${Math.round(h * 60)} min`
  return `${h.toFixed(1)} hr`
}
