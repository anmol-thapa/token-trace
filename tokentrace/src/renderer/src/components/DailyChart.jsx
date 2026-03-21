import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

export default function DailyChart({ data = [] }) {
  const formatted = data.map((d) => ({
    ...d,
    day: d.day?.slice(5) // "MM-DD"
  }))

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wide">
        Daily CO₂ — last 30 days
      </h2>
      {formatted.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickFormatter={(v) => `${v.toFixed(1)}g`}
            />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }}
              labelStyle={{ color: '#94a3b8' }}
              formatter={(v) => [`${v.toFixed(3)} g CO₂`, 'CO₂']}
            />
            <Line
              type="monotone"
              dataKey="co2"
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#22c55e' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
      No data yet — run a Claude Code or Codex session to start tracking.
    </div>
  )
}
