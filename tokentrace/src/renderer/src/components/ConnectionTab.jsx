import { useState, useEffect } from 'react'

const AnthropicIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-green-700" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
  </svg>
)

const OpenAIIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-green-700" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
  </svg>
)

const GeminiIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-green-700" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
  </svg>
)

const ChromeIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-green-700" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z" />
  </svg>
)

function ToolCard({ name, icon, description, configPath, status, onConnect, onDisconnect, onRestart }) {
  const [loading, setLoading] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [needsRestart, setNeedsRestart] = useState(false)

  const handleConnect = async () => {
    setLoading(true)
    await onConnect()
    setNeedsRestart(true)
    setLoading(false)
  }

  const handleDisconnect = async () => {
    setLoading(true)
    await onDisconnect()
    setNeedsRestart(true)
    setLoading(false)
  }

  const handleRestart = async () => {
    setRestarting(true)
    await onRestart()
    setNeedsRestart(false)
    setRestarting(false)
  }

  const connected = status?.connected

  return (
    <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center">{icon}</div>
          <div>
            <div className="font-semibold text-gray-900">{name}</div>
            <div className="text-xs text-gray-500">{description}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            <div className={`w-2 h-2 rounded-full ${status === null ? 'bg-green-500 animate-pulse' :
              connected ? 'bg-green-500' : 'bg-gray-300'
              }`} />
            <span className={connected ? 'text-gray-900' : 'text-gray-400'}>
              {status === null ? 'Checking...' : connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          {status !== null && (
            <button
              onClick={connected ? handleDisconnect : handleConnect}
              disabled={loading}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${connected
                ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                : 'bg-green-600 hover:bg-green-500 text-white'
                }`}
            >
              {loading ? '...' : connected ? 'Disconnect' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Config path */}
      <div className="px-5 pb-4 text-xs text-gray-400">
        Config: <code className="text-green-700">{configPath}</code>
        {status?.currentValue && !connected && (
          <span className="ml-2 text-yellow-600">currently set to <code>{status.currentValue}</code></span>
        )}
      </div>

      {/* Restart banner */}
      {needsRestart && (
        <div className="mx-4 mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-4">
          <span className="text-amber-700 text-sm">Restart {name} to apply changes</span>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="shrink-0 px-3 py-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors"
          >
            {restarting ? 'Restarting...' : 'Restart Now'}
          </button>
        </div>
      )}
    </div>
  )
}

const CompressIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-green-700 stroke-2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
)

function CompressionDetailModal({ event, onClose }) {
  if (!event) return null
  const { originalChars, compressedChars, originalText, compressedText } = event.compressionStats
  const pct  = Math.round((1 - compressedChars / originalChars) * 100)
  const orig = Math.ceil(originalChars / 4)
  const comp = Math.ceil(compressedChars / 4)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl border border-green-200 w-[720px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-green-100">
          <div>
            <div className="font-semibold text-gray-900">Compression Detail</div>
            <div className="text-xs text-gray-400 mt-0.5">{event.model} · {new Date(event.timestamp).toLocaleTimeString()}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-green-100 text-green-800 border border-green-200 text-sm font-semibold px-3 py-1 rounded-full">↓{pct}% · −{orig - comp} tokens</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-0 flex-1 overflow-hidden">
          <div className="flex flex-col border-r border-green-100 overflow-hidden">
            <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-green-50 bg-gray-50">
              Original · ~{orig} tokens
            </div>
            <div className="p-4 text-sm text-gray-700 overflow-auto whitespace-pre-wrap leading-relaxed flex-1">
              {originalText || <span className="text-gray-300 italic">Text not stored</span>}
            </div>
          </div>
          <div className="flex flex-col overflow-hidden">
            <div className="px-4 py-2 text-xs font-semibold text-green-700 uppercase tracking-wide border-b border-green-50 bg-green-50">
              Compressed · ~{comp} tokens
            </div>
            <div className="p-4 text-sm text-gray-700 overflow-auto whitespace-pre-wrap leading-relaxed flex-1">
              {compressedText || <span className="text-gray-300 italic">Text not stored</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CompressionCard({ enabled, onToggle, events = [] }) {
  const [selected, setSelected] = useState(null)
  const compressed = events.filter(e => e.compressionStats)

  // Group events with the same original text into a single row (recursive subagent calls)
  const grouped = compressed.reduce((acc, e) => {
    const key = e.compressionStats.originalText || `${e.compressionStats.originalChars}-${e.timestamp}`
    if (!acc[key]) acc[key] = { primary: e, extras: [] }
    else acc[key].extras.push(e)
    return acc
  }, {})
  const groupedRows = Object.values(grouped).sort((a, b) => b.primary.timestamp - a.primary.timestamp)

  const totalSaved = compressed.reduce((sum, e) => {
    const orig = Math.ceil(e.compressionStats.originalChars / 4)
    const comp = Math.ceil(e.compressionStats.compressedChars / 4)
    return sum + (orig - comp)
  }, 0)

  return (
    <>
    <CompressionDetailModal event={selected} onClose={() => setSelected(null)} />
    <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
      <div className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center"><CompressIcon /></div>
          <div>
            <div className="font-semibold text-gray-900 flex items-center gap-2">
              Prompt Compression
            </div>
            <div className="text-xs text-gray-500">Summarizes verbose user messages before forwarding</div>
          </div>
        </div>
        <button
          onClick={onToggle}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${enabled
            ? 'bg-green-600 hover:bg-green-500 text-white'
            : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
            }`}
        >
          {enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      <div className="px-5 pb-2 text-xs text-gray-400">
        Triggers on user messages &gt;600 chars · preserves all technical content · uses <code className="text-green-700">claude-3-5-haiku</code>
      </div>

      {/* Log */}
      <div className="mx-4 mb-4 mt-2 border-t border-green-100 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Recent compressions</span>
          {compressed.length > 0 && (
            <span className="text-xs text-gray-900 font-semibold">−{totalSaved.toLocaleString()} tokens saved total</span>
          )}
        </div>
        {compressed.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">
            {enabled ? 'No compressions yet — send a message longer than 600 chars' : 'Enable compression above to start saving tokens'}
          </div>
        ) : (
          <>
            {/* Header row */}
            <div className="grid text-xs text-gray-400 uppercase tracking-wide px-3 pb-1.5" style={{ gridTemplateColumns: '3.5rem 1fr 4.5rem 0.75rem 4rem 2.5rem 2.75rem', gap: '0 0.5rem' }}>
              <span>Time</span>
              <span>Model</span>
              <span className="text-right">Before</span>
              <span />
              <span>After</span>
              <span className="text-right">Saved</span>
              <span className="text-right">Ratio</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {groupedRows.slice(0, 10).map(({ primary: e, extras }, i) => {
                const orig = Math.ceil(e.compressionStats.originalChars / 4)
                const comp = Math.ceil(e.compressionStats.compressedChars / 4)
                const pct = Math.round((1 - e.compressionStats.compressedChars / e.compressionStats.originalChars) * 100)
                const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                const modelShort = (e.model || 'unknown').replace('claude-', '').replace(/-\d{8}$/, '')
                const allModels = [e, ...extras].map(x => (x.model || '').replace('claude-', '').replace(/-\d{8}$/, ''))
                return (
                  <div key={i} onClick={() => setSelected(e)} className="grid text-xs bg-gray-50 hover:bg-green-50 rounded-lg px-3 py-2 cursor-pointer transition-colors" style={{ gridTemplateColumns: '3.5rem 1fr 4.5rem 0.75rem 4rem 2.5rem 2.75rem', gap: '0 0.5rem', alignItems: 'center' }}>
                    <span className="text-gray-400 tabular-nums">{time}</span>
                    <span className="text-gray-500 truncate" title={allModels.join(', ')}>
                      {modelShort}{extras.length > 0 && <span className="ml-1 text-green-700 font-medium">+{extras.length}</span>}
                    </span>
                    <span className="text-gray-500 text-right tabular-nums">~{orig} tok</span>
                    <span className="text-gray-400 text-center">→</span>
                    <span className="text-gray-700 tabular-nums">~{comp} tok</span>
                    <span className="text-gray-900 font-semibold text-right tabular-nums">−{orig - comp}</span>
                    <span className="bg-green-100 text-green-800 border border-green-200 px-1.5 py-0.5 rounded text-center">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
    </>
  )
}

function ExtensionCard() {
  return (
    <div className="bg-white rounded-xl border border-green-200 overflow-hidden">
      <div className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center"><ChromeIcon /></div>
          <div>
            <div className="font-semibold text-gray-900">Browser Extension</div>
            <div className="text-xs text-gray-500">Tracks claude.ai &amp; ChatGPT via DOM observation</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-gray-700">Receiving events</span>
        </div>
      </div>
      <div className="px-5 pb-4 text-xs text-gray-400">
        Listening on{' '}
        <code className="bg-green-100 text-green-800 px-1 rounded text-xs">localhost:3002</code>
        {' '}— extension events flow into the same pipeline as CLI traffic.
      </div>
    </div>
  )
}

export default function ConnectionTab({ proxyPort }) {
  const [claudeStatus, setClaudeStatus] = useState(null)
  const [codexStatus, setCodexStatus] = useState(null)
  const [geminiStatus, setGeminiStatus] = useState(null)
  const refresh = async () => {
    const [c, o, g] = await Promise.all([
      window.api.getConnectionStatus(),
      window.api.getCodexStatus(),
      window.api.getGeminiStatus(),
    ])
    setClaudeStatus(c)
    setCodexStatus(o)
    setGeminiStatus(g)
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [])

  const proxyUrl = `http://localhost:${proxyPort}`

  return (
    <div className="space-y-4">
      <ToolCard
        name="Claude Code"
        icon={<AnthropicIcon />}
        description="Anthropic's AI coding CLI"
        configPath="~/.claude/settings.json"
        status={claudeStatus}
        onConnect={window.api.connectClaudeCode}
        onDisconnect={window.api.disconnectClaudeCode}
        onRestart={window.api.restartClaudeCode}
      />
      <ToolCard
        name="Codex CLI"
        icon={<OpenAIIcon />}
        description="OpenAI's coding agent"
        configPath="~/.codex/config.toml"
        status={codexStatus}
        onConnect={window.api.connectCodex}
        onDisconnect={window.api.disconnectCodex}
        onRestart={window.api.restartCodex}
      />

      <ToolCard
        name="Gemini CLI"
        icon={<GeminiIcon />}
        description="Google's AI coding CLI"
        configPath="~/.env → GEMINI_BASE_URL"
        status={geminiStatus}
        onConnect={window.api.connectGemini}
        onDisconnect={window.api.disconnectGemini}
        onRestart={window.api.restartGemini}
      />

      <ExtensionCard />

      {/* How it works */}
      <div className="bg-white rounded-xl p-5 border border-green-200 space-y-2">
        <div className="text-sm font-medium text-gray-700 uppercase tracking-wide">How it works</div>
        <div className="text-sm text-gray-500 space-y-1">
          <div>Connect routes each tool through the local proxy at <code className="bg-green-100 text-green-800 px-1 rounded text-xs">{proxyUrl}</code></div>
          <div>All API calls are forwarded transparently — no latency added, no data stored externally.</div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1 text-xs text-gray-400">
          <div><span className="text-green-700">Claude Code:</span> sets <code>ANTHROPIC_BASE_URL</code></div>
          <div><span className="text-green-700">Codex CLI:</span> sets <code>openai_base_url</code></div>
          <div><span className="text-green-700">Gemini CLI:</span> sets <code>GEMINI_BASE_URL</code> in <code>~/.env</code></div>
        </div>
      </div>
    </div>
  )
}
