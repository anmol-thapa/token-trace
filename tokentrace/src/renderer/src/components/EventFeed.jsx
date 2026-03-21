const PROVIDER_COLOR = {
  anthropic: 'text-orange-400',
  openai: 'text-blue-400'
}

export default function EventFeed({ events = [] }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wide">
        Live Event Feed
      </h2>
      {events.length === 0 ? (
        <div className="text-slate-500 text-sm py-6 text-center">
          Waiting for API calls…
        </div>
      ) : (
        <div className="overflow-auto max-h-64 space-y-1.5">
          {events.map((e, i) => (
            <div
              key={e.id || i}
              className="flex items-center gap-3 text-xs bg-slate-900 rounded-lg px-3 py-2"
            >
              <span className="text-slate-500 w-16 flex-shrink-0">
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`w-20 flex-shrink-0 font-medium ${PROVIDER_COLOR[e.provider] || 'text-slate-300'}`}>
                {e.provider}
              </span>
              <span className="flex-1 text-slate-300 truncate">{e.model}</span>
              <span className="text-slate-400 w-20 text-right flex-shrink-0">
                {(e.total_tokens || 0).toLocaleString()} tok
              </span>
              <span className="text-green-400 w-20 text-right flex-shrink-0 font-medium">
                {(e.co2_grams || 0).toFixed(4)} g
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
