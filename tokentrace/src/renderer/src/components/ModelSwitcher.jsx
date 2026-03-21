// Savings percentages derived from actual kWh/1K rates in emissions.js (tokens-methodology.md)
// Opus→Haiku: (0.01013-0.00055)/0.01013 = 94.6%
// Sonnet→Haiku: (0.00160-0.00055)/0.00160 = 65.6%
// GPT-4/turbo→mini: (0.00120-0.00012)/0.00120 = 90%
// GPT-4o→mini: (0.00060-0.00012)/0.00060 = 80%
const ALTERNATIVES = {
  'claude-opus':   { alt: 'claude-haiku', saving: 95 },
  'claude-sonnet': { alt: 'claude-haiku', saving: 66 },
  'gpt-4-turbo':   { alt: 'gpt-4o-mini', saving: 90 },
  'gpt-4o':        { alt: 'gpt-4o-mini', saving: 80 },
  'gpt-4':         { alt: 'gpt-4o-mini', saving: 90 },
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
