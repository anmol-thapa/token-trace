const ALTERNATIVES = {
  'claude-opus': { alt: 'claude-haiku', saving: 87 },
  'claude-sonnet': { alt: 'claude-haiku', saving: 80 },
  'gpt-4': { alt: 'gpt-4o-mini', saving: 87 },
  'gpt-4o': { alt: 'gpt-4o-mini', saving: 80 }
}

export default function ModelSwitcher({ byModel = [] }) {
  const suggestions = byModel
    .map((m) => {
      const key = Object.keys(ALTERNATIVES).find((k) => m.model.toLowerCase().includes(k))
      if (!key) return null
      const { alt, saving } = ALTERNATIVES[key]
      const savedCo2 = (m.co2 * saving) / 100
      return { from: m.model, to: alt, saving, savedCo2: savedCo2.toFixed(2) }
    })
    .filter(Boolean)
    .slice(0, 3)

  if (suggestions.length === 0) return null

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
        Switch & Save
      </h2>
      <ul className="space-y-3">
        {suggestions.map((s) => (
          <li key={s.from} className="text-xs">
            <div className="flex items-center gap-1 text-slate-400 mb-0.5">
              <span className="text-white font-medium truncate">{s.from}</span>
              <span>→</span>
              <span className="text-green-400 font-medium">{s.to}</span>
            </div>
            <div className="text-slate-500">
              saves <span className="text-green-400 font-semibold">{s.saving}%</span> CO₂{' '}
              <span className="text-slate-400">({s.savedCo2} g saved so far)</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
