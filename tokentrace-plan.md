# 🌱 TokenTrace — Hackathon Build Plan
**Sustainability + AI Track**

---

## 1. Project Overview

TokenTrace is a provider-agnostic middleware layer that sits between any LLM CLI tool or SDK app and its upstream API, measuring token usage in real time and translating it into CO₂ emissions data. A native Electron desktop app runs silently in the background — starting the proxy server automatically — and surfaces a live dashboard with charts, emissions breakdowns, and actionable offset suggestions.

> **One-line pitch:** "Plug in one proxy URL. Know your carbon footprint for every AI call, forever."

### Problem
- LLMs are energy-intensive — estimates range from 0.001–0.01 kWh per 1K tokens depending on model and datacenter
- No existing tool tracks emissions across multiple providers in one place
- Developers have no feedback loop on the environmental cost of their prompts
- Switching to a smaller model (e.g. Haiku vs. Opus) can reduce emissions 15x, but nobody knows this in practice

### Solution
- An Electron desktop app that runs a local proxy server in the background
- Intercepts API calls from Claude Code, Codex CLI, and any SDK-based app
- Extracts token counts from every request/response (including streaming)
- Calculates CO₂ emissions using per-model energy profiles and grid carbon intensity
- Stores everything in a local SQLite database
- Displays live stats, charts, and offset guidance in the Electron window

### Scope — What Is and Isn't Tracked

| Client | Tracked? | How |
|---|---|---|
| Claude Code | ✅ Yes | `claude config set api-base-url http://localhost:3001` |
| Codex CLI | ✅ Yes | `export OPENAI_BASE_URL=http://localhost:3001` |
| Custom app (Anthropic SDK) | ✅ Yes | `baseURL: 'http://localhost:3001'` in client config |
| Custom app (OpenAI SDK) | ✅ Yes | `baseURL: 'http://localhost:3001'` in client config |
| claude.ai (browser) | ❌ No | API calls happen server-side — not interceptable |
| ChatGPT (browser) | ❌ No | API calls happen server-side — not interceptable |

---

## 2. Architecture

### System Diagram

```
Claude Code / Codex CLI / SDK App
                |
                v  (baseURL = http://localhost:3001)
+---------------------------------------+
|         Electron Desktop App          |
|                                       |
|   Main Process (Node.js)              |
|   +---------------------------------+ |
|   |       Proxy Server              | |
|   |  1. Detect provider             | |
|   |  2. Forward to upstream API     | |
|   |  3. Stream response to client   | |
|   |  4. Extract token usage         | |
|   |  5. Calculate CO₂               | |
|   |  6. Write to SQLite DB          | |
|   +---------------------------------+ |
|                                       |
|   Renderer Process (React)            |
|   +---------------------------------+ |
|   |       Dashboard Window          | |
|   |  - Live token + CO₂ feed        | |
|   |  - Historical charts            | |
|   |  - Model breakdown              | |
|   |  - Offset suggestions           | |
|   +---------------------------------+ |
+---------------------------------------+
          |               |
  Anthropic API       OpenAI API
```

### Electron Process Split

| Process | Responsibilities |
|---|---|
| **Main process** | Starts proxy server, manages SQLite DB, exposes stats via IPC, system tray icon |
| **Renderer process** | React dashboard, reads stats via IPC, displays charts and live feed |

### Provider Detection Logic

The proxy auto-detects which provider to forward to, in priority order:
1. `X-Provider` request header (explicit override)
2. Request path: `/messages` → Anthropic, `/chat/completions` → OpenAI
3. API key prefix: `sk-ant-` → Anthropic, `sk-` → OpenAI

### Streaming Architecture

Claude Code and Codex CLI both use streaming by default. The proxy handles this with a pipe-through pattern:

- Chunks are piped to the client **immediately** as they arrive — zero buffering, zero added latency
- Each chunk is simultaneously scanned for token usage metadata
- **Anthropic:** tokens appear in `message_start` and `message_delta` SSE events
- **OpenAI:** `stream_options: { include_usage: true }` is injected automatically; tokens appear in the final chunk
- Usage is logged to SQLite after the stream closes (non-blocking)

---

## 3. Tech Stack

| Component | Tech | Est. Time |
|---|---|---|
| Electron shell | Electron + electron-builder | 1 hr |
| Proxy Server | Node.js + Express (main process) | 2 hrs |
| Emissions Math | Custom JS module | 1 hr |
| Database | SQLite (better-sqlite3) | 1 hr |
| IPC / Stats bridge | Electron `ipcMain` / `ipcRenderer` | 1 hr |
| React Dashboard | React + Recharts + Tailwind (renderer) | 4 hrs |
| System tray + auto-start | Electron `Tray` API | 0.5 hr |
| Demo setup | Configured clients + live data | 1 hr |

### Why These Choices
- **Electron** — proxy is already Node.js; runs natively in the main process with zero extra overhead. Single distributable app, no terminal required.
- **better-sqlite3** — synchronous SQLite with WAL mode, perfect for high-frequency writes from streaming responses
- **Recharts** — declarative charts that work out of the box with React state
- **electron-builder** — packages the app as a `.dmg` (macOS) or `.exe` (Windows) for easy distribution

---

## 4. Emissions Calculation

### Formula

```
weighted_tokens = input_tokens + (output_tokens × 3)
  # output tokens cost ~3x more (generation vs. prefill)

energy_kwh = (weighted_tokens / 1000) × model_kwh_per_1k_tokens

co2_grams = energy_kwh × grid_carbon_intensity_g_per_kwh
  # US avg grid: 386 gCO₂/kWh (EPA 2023)
```

### Per-Model Energy Profiles

Energy estimates in kWh per 1K tokens, based on Patterson et al. 2021 and Luccioni et al. 2023:

| Model | kWh / 1K tokens |
|---|---|
| claude-opus-4 / gpt-4 / o1 | 0.0030–0.0050 |
| claude-sonnet / gpt-4o | 0.0010–0.0020 |
| claude-haiku / gpt-4o-mini | 0.0002–0.0004 |
| o3 (reasoning) | 0.0080 |
| Default (unknown model) | 0.0010 |

### Human-Readable Comparisons

Each calculation returns relatable comparisons for the dashboard:
- **Car distance:** `co2_grams ÷ 120 g/km × 1000` = meters driven
- **Phone charge:** `co2_grams ÷ 0.05 g/%` = phone charge percentage points
- **Video streaming:** `co2_grams × 60` = seconds of HD video
- **Tree offset:** `co2_grams ÷ 57.5 g/day × 86400` = seconds for one tree to absorb

---

## 5. Component Breakdown

### 5.1 Electron Shell (`main.js`) 🔲 To Build

- Creates the `BrowserWindow` for the dashboard
- Starts the proxy server and SQLite DB on app launch
- `Tray` icon — app stays alive when window is closed
- `ipcMain` handlers expose stats and recent events to the renderer
- `app.setLoginItem` for optional launch-at-login

### 5.2 Proxy Server (`proxy/index.js`) 🔲 To Build

- Accepts all HTTP methods on any path
- Detects provider from path, API key prefix, or `X-Provider` header
- Rebuilds request headers with correct upstream host
- For OpenAI streaming: injects `stream_options` automatically
- Pipes response chunks to client while extracting token metadata
- Calls `logAndEmit()` after stream ends — never blocks the response

### 5.3 Emissions Module (`lib/emissions.js`) 🔲 To Build

- `MODEL_PROFILES` map: model name → kWh per 1K tokens
- Prefix matching for versioned model names (e.g. `claude-3-5-sonnet-20241022`)
- `calculateEmissions(model, inputTokens, outputTokens)` returns `energy_kwh`, `co2_grams`, `co2_comparisons`
- Grid carbon intensity constant — can be made dynamic via ElectricityMaps API

### 5.4 Database (`db/index.js`) 🔲 To Build

- SQLite with WAL journal mode for concurrent read/write
- `usage_events` table: provider, model, input/output/total tokens, CO₂, energy, session_id, timestamp
- Indexes on timestamp, session_id, provider for fast dashboard queries
- `getStats({ since, provider, session_id })` returns totals, byModel breakdown, byDay time series
- `getRecentEvents(limit)` for live feed in dashboard

### 5.5 React Dashboard (`renderer/`) 🔲 To Build

- Session summary bar: tokens in / tokens out / total CO₂ this session
- Historical line chart: daily CO₂ over last 30 days (Recharts `LineChart`)
- Model breakdown pie chart: which model is producing most emissions
- Relatable comparison card: "Today = driving X meters"
- Offset suggestions panel: links to Wren, Terrapass; tree equivalents
- Model switcher widget: "Switching to Haiku saves X g CO₂/day"
- Live event feed: last N API calls with tokens + emissions

---

## 6. Build Timeline

Assumes a 24-hour hackathon with a 3-person team.

| Phase | Time | Tasks | Deliverable |
|---|---|---|---|
| Setup | Hour 0–2 | Repo, Electron shell, proxy skeleton, SQLite schema, tray icon | App launches, proxy running |
| Core proxy | Hour 2–5 | Provider detection, forwarding, streaming pipe-through, token extraction | Tokens logging to DB |
| Emissions | Hour 5–6 | emissions.js, model profiles, comparisons | CO₂ data in DB |
| IPC bridge | Hour 6–7 | ipcMain stats handlers, renderer ipcRenderer calls | Dashboard can read DB |
| Dashboard | Hour 7–12 | React app, Recharts charts, session bar, model breakdown, offset panel | Working dashboard in Electron |
| Integration | Hour 12–16 | Connect all pieces, seed real data, test Claude Code + Codex end-to-end | Full demo flow |
| Polish | Hour 16–20 | UI/UX, edge cases, error handling, model switcher widget | Demo-ready |
| Pitch prep | Hour 20–24 | Slides, talking points, demo script, fallback screenshots | Presentation ready |

---

## 7. Client Integration Guide

### Claude Code
```bash
claude config set api-base-url http://localhost:3001
```

### OpenAI Codex CLI
```bash
export OPENAI_BASE_URL=http://localhost:3001
```

### OpenAI SDK
```js
import OpenAI from 'openai'
const client = new OpenAI({ baseURL: 'http://localhost:3001' })
```

### Anthropic SDK
```js
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic({ baseURL: 'http://localhost:3001' })
```

---

## 8. Stretch Goals

In priority order — tackle these if you finish early:

**1. Real-time WebSocket / IPC push updates**
- Emit an IPC event from proxy on every `logAndEmit()` call
- Dashboard updates charts live without polling

**2. Dynamic grid carbon intensity via ElectricityMaps API**
- `GET https://api.electricitymap.org/v3/carbon-intensity/latest?zone=US-NY`
- Swap the hardcoded 386 gCO₂/kWh constant with live regional data

**3. Model recommendation engine**
- Analyze last 7 days of usage and suggest cheaper/greener models
- "Your prompts average 200 tokens. Haiku would save 87% CO₂ at same quality"

**4. Per-project / per-session tagging**
- `X-Session-ID` header support in the proxy
- UI to name sessions and compare project footprints

**5. Carbon offset purchase flow**
- Integrate Wren or Terrapass API to calculate and initiate offset purchases
- "You've offset X kg CO₂ this month" badge

**6. Export & sharing**
- CSV/JSON export of usage history
- Shareable link showing your monthly emissions report

---

## 9. Pitch Notes

### Demo Flow

1. Launch the TokenTrace app — proxy starts automatically, tray icon appears
2. Run `claude config set api-base-url http://localhost:3001` in terminal
3. Run a real Claude Code session — generate some code, ask follow-up questions
4. Click the tray icon to open the dashboard — show it updating live with token counts and CO₂
5. Point to model breakdown: "That session used Opus. Here's what it cost in carbon"
6. Click the model switcher: "Switching to Haiku for tasks like this saves 87% CO₂"
7. Show offset panel: "One tree for 3 minutes would offset that session"

### Judging Criteria Alignment

| Criterion | How TokenTrace hits it |
|---|---|
| Sustainability impact | Direct measurement + offset pathway for AI's fastest-growing emission source |
| AI integration | Native integration with Claude, OpenAI, Codex — works with any LLM tool |
| Technical depth | Proxy architecture, streaming SSE parsing, per-model energy profiles, Electron IPC |
| Novelty | No existing tool does provider-agnostic LLM carbon tracking as a native desktop app |
| Demo-ability | Live terminal → desktop dashboard flow is visually compelling and reproducible |

### One-Sentence Answers to Hard Questions

- **"Why a desktop app and not a web app?"** — The proxy needs to run persistently in the background; a native app with a tray icon is the natural fit and requires no terminal.
- **"Why a proxy and not a plugin?"** — A proxy works for every client without any code changes, including CLI tools and third-party apps.
- **"Are the emissions numbers accurate?"** — They're estimates based on published research (Luccioni 2023); we surface our methodology and error bars openly.
- **"What about privacy?"** — Everything runs locally. No data leaves your machine except to the LLM APIs you're already calling.
- **"How do you handle streaming?"** — We pipe chunks to the client instantly and extract token metadata from SSE events in parallel, so latency is unaffected.

---

## 10. Open Questions & Decisions

| Question | Recommendation |
|---|---|
| Electron IPC or local HTTP for dashboard data? | IPC — faster, no port conflicts, more native |
| How to package SQLite with Electron? | better-sqlite3 with electron-rebuild in postinstall |
| How do we handle HTTPS upstream? | Proxy uses Node `https` module — no SSL termination needed for local use |
| What if the user's API key is on the client side? | Proxy passes `Authorization` header through unchanged; no key ever touches our code |
| Anthropic streaming format changes? | Pin to current SSE format; add `X-Anthropic-Version` header passthrough |

---

*TokenTrace — Team Use Only*
