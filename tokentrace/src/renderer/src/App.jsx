import { useState, useEffect, useCallback } from 'react'
import SessionBar from './components/SessionBar'
import DailyChart from './components/DailyChart'
import ModelBreakdown from './components/ModelBreakdown'
import EventFeed from './components/EventFeed'
import ComparisonCard from './components/ComparisonCard'
import ModelSwitcher from './components/ModelSwitcher'

const POLL_MS = 5000

export default function App() {
  const [stats, setStats] = useState(null)
  const [daily, setDaily] = useState([])
  const [events, setEvents] = useState([])
  const [proxyPort, setProxyPort] = useState(3001)
  const [sessionCo2, setSessionCo2] = useState(0)
  const [sessionTokens, setSessionTokens] = useState(0)

  const refresh = useCallback(async () => {
    const [s, d, e] = await Promise.all([
      window.api.getStats(),
      window.api.getDaily(),
      window.api.getEvents(50)
    ])
    setStats(s)
    setDaily(d)
    setEvents(e)
  }, [])

  useEffect(() => {
    window.api.getProxyPort().then(setProxyPort)
    refresh()
    const interval = setInterval(refresh, POLL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  // Live push from proxy
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
          energy_kwh: evt.energyKwh
        },
        ...prev.slice(0, 49)
      ])
      // Refresh totals after each event
      refresh()
    })
    return unsub
  }, [refresh])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col">
      {/* Title bar drag region */}
      <div className="h-8 bg-slate-900" style={{ WebkitAppRegion: 'drag' }} />

      <div className="flex-1 px-6 pb-6 space-y-4 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              🌱 TokenTrace
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Proxy active on{' '}
              <code className="bg-slate-800 px-1.5 py-0.5 rounded text-green-400 text-xs">
                http://localhost:{proxyPort}
              </code>
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 uppercase tracking-wide">This session</div>
            <div className="text-lg font-semibold text-green-400">
              {sessionCo2.toFixed(2)} g CO₂
            </div>
            <div className="text-xs text-slate-400">{sessionTokens.toLocaleString()} tokens</div>
          </div>
        </div>

        <SessionBar stats={stats} sessionCo2={sessionCo2} sessionTokens={sessionTokens} />

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <DailyChart data={daily} />
          </div>
          <div className="space-y-4">
            <ComparisonCard stats={stats} />
            <ModelSwitcher byModel={stats?.byModel} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1">
            <ModelBreakdown byModel={stats?.byModel} />
          </div>
          <div className="col-span-2">
            <EventFeed events={events} />
          </div>
        </div>
      </div>
    </div>
  )
}
