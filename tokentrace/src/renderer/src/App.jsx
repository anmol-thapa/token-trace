import { useState, useEffect, useCallback } from 'react'
import SessionBar from './components/SessionBar'
import DailyChart from './components/DailyChart'
import EventFeed from './components/EventFeed'
import ImpactTab from './components/ImpactTab'
import ConnectionTab, { CompressionCard } from './components/ConnectionTab'
import { DEMO_DATASETS } from './demoData'

const POLL_MS = 5000

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [daily, setDaily] = useState([])
  const [events, setEvents] = useState([])
  const [proxyPort, setProxyPort] = useState(3001)
  const [sessionCo2, setSessionCo2] = useState(0)
  const [sessionTokens, setSessionTokens] = useState(0)
  const [compressionEnabled, setCompressionEnabled] = useState(false)
  const [dataSource, setDataSource] = useState('live')

  const activeDataset = dataSource === 'live' ? null : DEMO_DATASETS.find(d => d.id === dataSource)
  const displayEvents = activeDataset ? activeDataset.events : events
  const displayStats  = activeDataset ? activeDataset.stats  : stats
  const displayDaily  = activeDataset ? activeDataset.daily  : daily

  const refresh = useCallback(async () => {
    const [s, d, e] = await Promise.all([
      window.api.getStats(),
      window.api.getDaily(),
      window.api.getEvents(500)
    ])
    setStats(s)
    setDaily(d)
    setEvents(e)
  }, [])

  useEffect(() => {
    window.api.getProxyPort().then(setProxyPort)
    window.api.getCompressionEnabled().then(v => setCompressionEnabled(!!v))
    refresh()
    const interval = setInterval(refresh, POLL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    const unsub = window.api.onUsageEvent((evt) => {
      setSessionCo2((prev) => prev + evt.co2Grams)
      setSessionTokens((prev) => prev + evt.inputTokens + evt.outputTokens)
      setEvents((prev) => [
        {
          id: Date.now(),
          timestamp: evt.timestamp,
          provider: evt.provider,
          model: evt.model,
          input_tokens: evt.inputTokens,
          output_tokens: evt.outputTokens,
          total_tokens: evt.inputTokens + evt.outputTokens,
          co2_grams: evt.co2Grams,
          energy_kwh: evt.energyKwh,
          compressionStats: evt.compressionStats || null
        },
        ...prev.slice(0, 499)
      ])
      refresh()
    })
    return unsub
  }, [refresh])

  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      <div className="h-8 bg-white" style={{ WebkitAppRegion: 'drag' }} />

      <div className="flex-1 px-6 pb-6 space-y-4 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">🌱 TokenTrace</h1>
          <div className="flex items-center gap-4">
            {/* Data source selector */}
            <div className="flex items-center gap-2">
              <select
                value={dataSource}
                onChange={e => setDataSource(e.target.value)}
                className="text-xs border border-green-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-green-400 cursor-pointer"
              >
                <option value="live">🔴 Live</option>
                {DEMO_DATASETS.map(d => (
                  <option key={d.id} value={d.id}>▶ {d.label}</option>
                ))}
              </select>
            </div>
            <div className="text-right">
              <div className="text-xs text-green-600 uppercase tracking-wide">This session</div>
              <div className="text-lg font-semibold text-gray-900">{sessionCo2.toFixed(2)} g CO₂</div>
              <div className="text-xs text-green-600">{sessionTokens.toLocaleString()} tokens</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-green-50 rounded-lg p-1 w-fit border border-green-200">
          {[['dashboard', 'Dashboard'], ['impact', 'Impact'], ['connection', 'Connection']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === id ? 'bg-green-600 text-white' : 'text-green-700 hover:text-green-900'
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && (
          <>
            <SessionBar stats={displayStats} />
            <CompressionCard
              enabled={compressionEnabled}
              events={displayEvents}
              onToggle={async () => {
                const next = !compressionEnabled
                setCompressionEnabled(next)
                await window.api.setCompressionEnabled(next)
              }}
            />
            <div className="grid grid-cols-2 gap-4">
              <DailyChart data={displayDaily} />
              <EventFeed events={displayEvents.slice(0, 50)} />
            </div>
          </>
        )}

        {tab === 'impact' && (
          <ImpactTab stats={displayStats} daily={displayDaily} events={displayEvents} />
        )}

        {tab === 'connection' && <ConnectionTab proxyPort={proxyPort} />}
      </div>
    </div>
  )
}
