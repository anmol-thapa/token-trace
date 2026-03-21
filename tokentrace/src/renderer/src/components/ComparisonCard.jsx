export default function ComparisonCard({ stats }) {
  const co2 = stats?.totals?.totalCo2 || 0

  const carMeters = Math.round((co2 / 120) * 1000)
  const phonePercent = Math.round(co2 / 0.05)
  const videoSeconds = Math.round(co2 * 60)
  const treeSeconds = Math.round((co2 / 57.5) * 86400)

  const rows = [
    { emoji: '🚗', label: 'Driving', value: carMeters >= 1000 ? `${(carMeters / 1000).toFixed(2)} km` : `${carMeters} m` },
    { emoji: '📱', label: 'Phone charge', value: `${Math.min(phonePercent, 100)}%` },
    { emoji: '📺', label: 'HD video', value: fmtSeconds(videoSeconds) },
    { emoji: '🌳', label: 'Tree absorbs in', value: fmtSeconds(treeSeconds) }
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

function fmtSeconds(s) {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${(s / 3600).toFixed(1)}h`
}
