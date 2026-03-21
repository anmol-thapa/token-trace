import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4']

export default function ModelBreakdown({ byModel = [] }) {
  const data = byModel.map((m) => ({ name: m.model, value: parseFloat(m.co2.toFixed(4)) }))

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
        By Model
      </h2>
      {data.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-slate-500 text-sm">No data</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} strokeWidth={0}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }}
                formatter={(v) => [`${v} g CO₂`]}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="mt-2 space-y-1">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center gap-2 text-xs text-slate-400">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="truncate flex-1">{d.name}</span>
                <span className="text-slate-300">{d.value} g</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
