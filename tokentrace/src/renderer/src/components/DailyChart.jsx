import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

export default function DailyChart({ data = [] }) {
  const formatted = data.map((d) => ({
    ...d,
    day: d.day?.slice(5)
  }))

  return (
    <div className="bg-white rounded-xl p-4 border border-green-200">
      <h2 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">
        Daily CO₂ — last 30 days
      </h2>
      {formatted.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={formatted}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="day" tick={{ fill: '#16a34a', fontSize: 11 }} />
            <YAxis
              tick={{ fill: '#16a34a', fontSize: 11 }}
              tickFormatter={(v) => `${v.toFixed(1)}g`}
            />
            <Tooltip
              contentStyle={{ background: '#ffffff', border: '1px solid #bbf7d0', borderRadius: 8 }}
              labelStyle={{ color: '#16a34a' }}
              formatter={(v) => [`${v.toFixed(3)} g CO₂`, 'CO₂']}
            />
            <Line
              type="monotone"
              dataKey="co2"
              stroke="#16a34a"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#16a34a' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
      No data yet — run a Claude Code or Codex session to start tracking.
    </div>
  )
}
