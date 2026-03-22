import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'

const COLORS = ['#16a34a', '#4ade80', '#fbbf24', '#f97316', '#60a5fa', '#a78bfa']

const PieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div style={{ background: '#fff', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ color: '#16a34a', fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{name}</div>
      <div style={{ color: '#111827', fontSize: 12 }}>{value} g CO₂</div>
    </div>
  )
}

const ALTERNATIVES = {
  'claude-opus':   { alt: 'claude-haiku',  saving: 95 },
  'claude-sonnet': { alt: 'claude-haiku',  saving: 66 },
  'gpt-4-turbo':   { alt: 'gpt-4o-mini',  saving: 90 },
  'gpt-4o':        { alt: 'gpt-4o-mini',  saving: 80 },
  'gpt-4':         { alt: 'gpt-4o-mini',  saving: 90 },
}

const TIPS = [
  { icon: '📏', tip: 'Trim system prompts — every token is re-sent on every request.' },
  { icon: '⚡', tip: 'Batch multiple small questions into one prompt to cut overhead.' },
  { icon: '🔁', tip: 'Cache repeated context locally instead of re-sending each turn.' },
  { icon: '🎯', tip: 'Use streaming only when needed — polling adds extra round trips.' },
]

const RANGES = [
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
  { label: '7d',  ms: 7  * 24 * 60 * 60 * 1000 },
  { label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '6m',  ms: 180 * 24 * 60 * 60 * 1000 },
  { label: '1y',  ms: 365 * 24 * 60 * 60 * 1000 },
]

export default function ImpactTab({ daily, events }) {
  const [range, setRange] = useState('30d')

  const rangeMs  = RANGES.find(r => r.label === range)?.ms ?? RANGES[2].ms
  const since    = Date.now() - rangeMs
  const filtered = events.filter(e => e.timestamp >= since)
  const filteredDaily = daily.filter(d => new Date(d.day).getTime() >= since)

  // ── Totals from filtered events ───────────────────────────────────────────
  const co2g  = filtered.reduce((s, e) => s + (e.co2_grams || 0), 0)
  const co2kg = co2g / 1000

  // ── Comparisons ───────────────────────────────────────────────────────────
  const carMeters    = co2kg / 0.12 * 1000
  const phonePercent = co2kg / 0.011 * 100
  const treeDays     = co2kg / 0.0575
  const bulbHours    = co2kg / 0.0232

  // ── Peak day ──────────────────────────────────────────────────────────────
  const peakDay = filteredDaily.length > 0
    ? filteredDaily.reduce((max, d) => d.co2 > (max?.co2 || 0) ? d : max, null)
    : null

  // ── Hourly token distribution ─────────────────────────────────────────────
  const hourBuckets = Array(24).fill(0)
  filtered.forEach(e => {
    const h = new Date(e.timestamp).getHours()
    hourBuckets[h] += (e.total_tokens || 0)
  })
  const hourlyData = hourBuckets.map((tokens, h) => ({
    label: h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`,
    tokens,
  }))
  const peakHour = hourlyData.reduce((max, d) => d.tokens > max.tokens ? d : max, hourlyData[0])

  // ── Model breakdown from filtered events ──────────────────────────────────
  const modelMap = {}
  filtered.forEach(e => {
    if (!e.model) return
    if (!modelMap[e.model]) modelMap[e.model] = { model: e.model, co2: 0 }
    modelMap[e.model].co2 += e.co2_grams || 0
  })
  const byModel = Object.values(modelMap).sort((a, b) => b.co2 - a.co2)

  // Group slices < 10% of total into "Other" for pie chart
  const totalCo2 = byModel.reduce((s, m) => s + m.co2, 0)
  const mainSlices = []
  let otherCo2 = 0
  byModel.forEach(m => {
    if (totalCo2 > 0 && m.co2 / totalCo2 < 0.10) {
      otherCo2 += m.co2
    } else {
      mainSlices.push(m)
    }
  })
  if (otherCo2 > 0) mainSlices.push({ model: 'Other', co2: otherCo2 })
  const modelData = mainSlices.map(m => ({ name: m.model, value: parseFloat(m.co2.toFixed(4)) }))

  // Legend still uses full byModel list
  const legendData = byModel.map(m => ({ name: m.model, value: parseFloat(m.co2.toFixed(4)) }))

  // ── Top provider ──────────────────────────────────────────────────────────
  const providerTotals = {}
  filtered.forEach(e => {
    if (!e.provider) return
    providerTotals[e.provider] = (providerTotals[e.provider] || 0) + (e.total_tokens || 0)
  })
  const topProvider = Object.entries(providerTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  // ── Switch suggestions ────────────────────────────────────────────────────
  const suggestions = byModel
    .map(m => {
      const key = Object.keys(ALTERNATIVES).find(k => m.model.toLowerCase().includes(k))
      if (!key) return null
      const { alt, saving } = ALTERNATIVES[key]
      return { from: m.model, to: alt, saving, savedCo2: ((m.co2 * saving) / 100).toFixed(2) }
    })
    .filter(Boolean)
    .slice(0, 3)

  // ── Compression impact ────────────────────────────────────────────────────
  const compressed   = filtered.filter(e => e.compressionStats)
  const tokensSaved  = compressed.reduce((sum, e) =>
    sum + Math.ceil(e.compressionStats.originalChars / 4) - Math.ceil(e.compressionStats.compressedChars / 4), 0)
  const avgPct = compressed.length === 0 ? 0 : Math.round(
    compressed.reduce((sum, e) => sum + (1 - e.compressionStats.compressedChars / e.compressionStats.originalChars), 0)
    / compressed.length * 100
  )
  const co2SavedG = (tokensSaved / 1000) * 0.00040 * 386

  return (
    <div className="space-y-4">

      {/* Timeline selector */}
      <div className="flex items-center gap-1 bg-green-50 rounded-lg p-1 w-fit border border-green-200">
        {RANGES.map(r => (
          <button
            key={r.label}
            onClick={() => setRange(r.label)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              range === r.label
                ? 'bg-green-600 text-white'
                : 'text-green-700 hover:text-green-900'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Row 1: Footprint + Patterns */}
      <div className="grid grid-cols-2 gap-4">

        {/* Carbon Footprint */}
        <div className="bg-white rounded-xl p-5 border border-green-200">
          <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-4">
            Your Carbon Footprint
          </div>
          <div className="text-4xl font-bold text-gray-900 tabular-nums">
            {co2g.toFixed(2)}<span className="text-xl font-normal text-green-600 ml-1">g CO₂</span>
          </div>
          <div className="text-xs text-gray-400 mt-1 mb-5">last {range} · all tools &amp; sessions</div>

          <div className="space-y-3">
            {[
              { icon: '🚗', label: 'Equivalent driving', value: carMeters >= 1000 ? `${(carMeters / 1000).toFixed(2)} km` : `${Math.round(carMeters)} m` },
              { icon: '📱', label: 'Phone charges',       value: `${phonePercent.toFixed(1)}%` },
              { icon: '🌳', label: 'Tree absorbs in',     value: fmtDays(treeDays) },
              { icon: '💡', label: '60W bulb powered',    value: fmtHours(bulbHours) },
            ].map(({ icon, label, value }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-gray-500">{icon} {label}</span>
                <span className="text-sm font-semibold text-gray-900">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Usage Patterns */}
        <div className="bg-white rounded-xl p-5 border border-green-200">
          <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-4">
            Usage Patterns
          </div>

          <div className="grid grid-cols-3 gap-2 mb-5">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Heaviest day</div>
              <div className="text-base font-bold text-gray-900">{peakDay ? peakDay.day?.slice(5) : '—'}</div>
              <div className="text-xs text-gray-600">{peakDay ? `${peakDay.co2.toFixed(2)} g` : 'No data'}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Peak hour</div>
              <div className="text-base font-bold text-gray-900">{peakHour.tokens > 0 ? peakHour.label : '—'}</div>
              <div className="text-xs text-gray-600">{peakHour.tokens > 0 ? `${(peakHour.tokens / 1000).toFixed(1)}K tok` : 'No data'}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Top provider</div>
              <div className="text-base font-bold text-gray-900 capitalize">{topProvider || '—'}</div>
              <div className="text-xs text-orange-500">{topProvider ? `${(providerTotals[topProvider] / 1000).toFixed(1)}K tok` : 'No data'}</div>
            </div>
          </div>

          <div className="text-xs text-gray-400 uppercase tracking-wide mb-2">Tokens by hour of day</div>
          {filtered.length === 0 ? (
            <div className="h-20 flex items-center justify-center text-gray-400 text-xs">No events in this range</div>
          ) : (
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={hourlyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fill: '#16a34a', fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: '#ffffff', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 11 }}
                  formatter={v => [`${v.toLocaleString()} tokens`, 'Volume']}
                />
                <Bar dataKey="tokens" fill="#4ade80" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Compression Impact */}
      <div className="bg-white rounded-xl p-5 border border-green-200">
        <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-4">Your Compression Impact</div>
        {compressed.length === 0 ? (
          <div className="text-center py-4 text-gray-400 text-sm">
            No compressions in this range — enable Prompt Compression on the Dashboard and send a long message
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Prompts compressed</div>
              <div className="text-xl font-bold text-gray-900">{compressed.length}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Tokens saved</div>
              <div className="text-xl font-bold text-gray-900">−{tokensSaved.toLocaleString()}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">CO₂ avoided</div>
              <div className="text-xl font-bold text-gray-900">{co2SavedG.toFixed(3)} g</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Avg reduction</div>
              <div className="text-xl font-bold text-gray-900">{avgPct}%</div>
            </div>
          </div>
        )}
      </div>

      {/* Row 2: Model Breakdown + Reduce Impact */}
      <div className="grid grid-cols-2 gap-4">

        {/* Emissions by Model */}
        <div className="bg-white rounded-xl p-5 border border-green-200">
          <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-3">
            Emissions by Model
          </div>
          {modelData.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-gray-400 text-sm">No data in this range</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={modelData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={62} strokeWidth={0} paddingAngle={0}>
                    {modelData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="mt-3 space-y-1.5">
                {legendData.map((d, i) => (
                  <li key={d.name} className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="truncate flex-1">{d.name}</span>
                    <span className="text-gray-700 tabular-nums">{d.value} g</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Reduce Impact */}
        <div className="bg-white rounded-xl p-5 border border-green-200 space-y-5">
          {suggestions.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-3">
                Switch &amp; Save
              </div>
              <ul className="space-y-2">
                {suggestions.map(s => (
                  <li key={s.from} className="bg-gray-50 rounded-lg px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-sm mb-0.5">
                      <span className="text-gray-900 font-medium truncate max-w-[120px]">{s.from}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-gray-900 font-medium">{s.to}</span>
                    </div>
                    <div className="text-xs text-gray-400">
                      saves <span className="text-gray-900 font-semibold">{s.saving}%</span> CO₂
                      <span className="ml-1 text-gray-400">· {s.savedCo2} g saved so far</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-3">
              Reduce Your Impact
            </div>
            <ul className="space-y-3">
              {TIPS.map(({ icon, tip }) => (
                <li key={tip} className="flex gap-2.5 text-xs text-gray-500 leading-relaxed">
                  <span className="flex-shrink-0 text-sm">{icon}</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
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
