const PROVIDER_COLOR = {
  anthropic: 'text-orange-500',
  openai: 'text-gray-700'
}

const COL = '6.5rem 5rem 1fr 5.5rem 5.5rem 3rem'

export default function EventFeed({ events = [] }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-green-200">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
        Live Event Feed
      </h2>
      {events.length === 0 ? (
        <div className="text-gray-400 text-sm py-6 text-center">
          Waiting for API calls…
        </div>
      ) : (
        <>
          {/* Header row */}
          <div className="grid text-xs text-gray-400 uppercase tracking-wide px-3 pb-1.5" style={{ gridTemplateColumns: COL, gap: '0 0.5rem' }}>
            <span>Time</span>
            <span>Provider</span>
            <span>Model</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">CO₂</span>
            <span className="text-right">Saved</span>
          </div>
          <div className="overflow-auto max-h-60 space-y-1.5">
            {events.map((e, i) => (
              <div
                key={e.id || i}
                className="grid text-xs bg-gray-50 rounded-lg px-3 py-2"
                style={{ gridTemplateColumns: COL, gap: '0 0.5rem', alignItems: 'center' }}
              >
                <span className="text-gray-400 tabular-nums">
                  {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`font-medium truncate ${PROVIDER_COLOR[e.provider] || 'text-gray-600'}`}>
                  {e.provider}
                </span>
                <span className="text-gray-600 truncate">{e.model}</span>
                <span className="text-green-600 text-right tabular-nums">
                  {(e.total_tokens || 0).toLocaleString()}
                </span>
                <span className="text-gray-900 text-right tabular-nums font-medium">
                  {(e.co2_grams || 0).toFixed(4)} g
                </span>
                <span className="text-right">
                  {e.compressionStats
                    ? <span className="bg-green-100 text-green-800 border border-green-200 px-1.5 py-0.5 rounded tabular-nums">↓{Math.round((1 - e.compressionStats.compressedChars / e.compressionStats.originalChars) * 100)}%</span>
                    : <span className="text-gray-300">—</span>
                  }
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
