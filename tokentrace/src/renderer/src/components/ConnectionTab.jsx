import { useState, useEffect } from 'react'

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
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <div className="font-semibold text-white">{name}</div>
            <div className="text-xs text-slate-400">{description}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              status === null ? 'bg-slate-500 animate-pulse' :
              connected ? 'bg-green-400' : 'bg-slate-500'
            }`} />
            <span className={connected ? 'text-green-400' : 'text-slate-400'}>
              {status === null ? 'Checking...' : connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          {status !== null && (
            <button
              onClick={connected ? handleDisconnect : handleConnect}
              disabled={loading}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                connected
                  ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                  : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
            >
              {loading ? '...' : connected ? 'Disconnect' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Config path */}
      <div className="px-5 pb-4 text-xs text-slate-500">
        Config: <code className="text-slate-400">{configPath}</code>
        {status?.currentValue && !connected && (
          <span className="ml-2 text-yellow-500">currently set to <code>{status.currentValue}</code></span>
        )}
      </div>

      {/* Restart banner */}
      {needsRestart && (
        <div className="mx-4 mb-4 bg-amber-900/40 border border-amber-700/50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-4">
          <span className="text-amber-300 text-sm">Restart {name} to apply changes</span>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="shrink-0 px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-md text-xs font-medium transition-colors"
          >
            {restarting ? 'Restarting...' : 'Restart Now'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function ConnectionTab({ proxyPort }) {
  const [claudeStatus, setClaudeStatus] = useState(null)
  const [codexStatus, setCodexStatus] = useState(null)

  const refresh = async () => {
    const [c, o] = await Promise.all([
      window.api.getConnectionStatus(),
      window.api.getCodexStatus(),
    ])
    setClaudeStatus(c)
    setCodexStatus(o)
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
        icon="🤖"
        description="Anthropic's AI coding CLI"
        configPath="~/.claude/settings.json"
        status={claudeStatus}
        onConnect={window.api.connectClaudeCode}
        onDisconnect={window.api.disconnectClaudeCode}
        onRestart={window.api.restartClaudeCode}
      />
      <ToolCard
        name="Codex CLI"
        icon="✳️"
        description="OpenAI's coding agent"
        configPath="~/.codex/config.toml"
        status={codexStatus}
        onConnect={window.api.connectCodex}
        onDisconnect={window.api.disconnectCodex}
        onRestart={window.api.restartCodex}
      />

      {/* How it works */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 space-y-2">
        <div className="text-sm font-medium text-slate-300 uppercase tracking-wide">How it works</div>
        <div className="text-sm text-slate-400 space-y-1">
          <div>Connect routes each tool through the local proxy at <code className="bg-slate-700 text-green-400 px-1 rounded text-xs">{proxyUrl}</code></div>
          <div>All API calls are forwarded transparently — no latency added, no data stored externally.</div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-1 text-xs text-slate-500">
          <div><span className="text-slate-400">Claude Code:</span> sets <code>ANTHROPIC_BASE_URL</code></div>
          <div><span className="text-slate-400">Codex CLI:</span> sets <code>openai_base_url</code></div>
        </div>
      </div>
    </div>
  )
}
