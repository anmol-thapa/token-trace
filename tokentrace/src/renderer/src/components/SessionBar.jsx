export default function SessionBar({ stats }) {
  const t = stats?.totals || {}

  const tiles = [
    { label: 'Total Calls', value: (t.callCount || 0).toLocaleString() },
    { label: 'Input Tokens', value: fmt(t.totalInput) },
    { label: 'Output Tokens', value: fmt(t.totalOutput) },
    { label: 'Total CO₂', value: `${(t.totalCo2 || 0).toFixed(1)} g` },
    { label: 'Energy Used', value: `${((t.totalEnergy || 0) * 1000).toFixed(2)} mWh` }
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {tiles.map(({ label, value }) => (
        <div key={label} className="bg-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</div>
          <div className="text-xl font-bold text-white">{value}</div>
        </div>
      ))}
    </div>
  )
}

function fmt(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
