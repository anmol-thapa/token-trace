# 🌱 TokenTrace — Build Plan (Live)
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
- AI coding agents silently send 10–12k tokens of system prompt + tool definitions on **every single request**, independent of conversation length — users have no visibility into this waste

### Solution
- An Electron desktop app that runs a local proxy server in the background
- Intercepts API calls from Claude Code, Codex CLI, and any SDK-based app
- One-click connection UI writes config directly into `~/.claude/settings.json` and `~/.codex/config.toml`
- Extracts token counts from every request/response (including streaming SSE)
- Calculates CO₂ emissions using per-model energy profiles and grid carbon intensity
- Stores everything in a local NDJSON database
- Displays live stats, charts, and offset guidance in the Electron window
- Automatically detaches from tools when the app closes so they continue working uninterrupted

### Scope — What Is and Isn't Tracked

| Client | Tracked? | How |
|---|---|---|
| Claude Code CLI | ✅ Yes | `ANTHROPIC_BASE_URL` written to `~/.claude/settings.json` |
| Codex CLI (API key mode) | ✅ Yes | `openai_base_url` written to `~/.codex/config.toml` |
| Custom app (Anthropic SDK) | ✅ Yes | `baseURL: 'http://localhost:3001'` in client config |
| Custom app (OpenAI SDK) | ✅ Yes | `baseURL: 'http://localhost:3001'` in client config |
| Claude macOS desktop app | ❌ No | Connects to claude.ai via OAuth — not the Anthropic API |
| Codex CLI (ChatGPT subscription) | ❌ No | OAuth token lacks `api.responses.write` scope when routed through proxy |
| claude.ai / ChatGPT (browser) | ❌ No | API calls happen server-side — not interceptable |

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
|   |       Proxy Server :3001        | |
|   |  1. Detect provider             | |
|   |  2. Short-circuit GET /responses| |
|   |  3. Forward to upstream API     | |
|   |  4. Stream response to client   | |
|   |  5. Extract token usage (SSE)   | |
|   |  6. Calculate CO₂               | |
|   |  7. Write to NDJSON DB          | |
|   +---------------------------------+ |
|                                       |
|   Renderer Process (React)            |
|   +---------------------------------+ |
|   |   Dashboard + Connection Tabs   | |
|   |  - Live token + CO₂ feed        | |
|   |  - Historical charts            | |
|   |  - Model breakdown              | |
|   |  - One-click connect/disconnect | |
|   +---------------------------------+ |
+---------------------------------------+
          |               |
  Anthropic API       OpenAI API
```

### Electron Process Split

| Process | Responsibilities |
|---|---|
| **Main process** | Proxy server, NDJSON DB, IPC handlers, config read/write for Claude Code + Codex, system tray, lifecycle cleanup |
| **Renderer process** | React dashboard + connection tab, reads stats via IPC, displays charts and live feed |

### Provider Detection Logic

The proxy auto-detects which provider to forward to, in priority order:
1. `X-Provider` request header (explicit override)
2. Request path: `/messages` → Anthropic, `/chat/completions` or `/responses` → OpenAI
3. API key prefix: `sk-ant-` → Anthropic, `sk-` → OpenAI

### Streaming Architecture

Claude Code uses the Messages API and Codex uses the Responses API — both streaming over SSE. The proxy handles this with a pipe-through pattern:

- For POST streaming requests, `200 text/event-stream` headers are sent **immediately** before the upstream responds, preventing client timeouts while the model cold-starts
- SSE keepalive comments (`: keepalive\n\n`) are injected every 5 seconds to keep the HTTP/1.1 connection alive
- Chunks are piped to the client **immediately** as they arrive — zero added latency
- Each chunk is simultaneously buffered for token extraction
- **Anthropic Messages API:** tokens in `message_start` (input) and `message_delta` (output) SSE events
- **OpenAI Responses API:** tokens in `response.completed` SSE event under `response.usage`
- **OpenAI Chat Completions:** `stream_options: { include_usage: true }` injected automatically; tokens in final chunk
- Usage is logged after the stream closes (non-blocking)

### Key Proxy Implementation Details

- `Accept-Encoding` is stripped from upstream requests — Anthropic/OpenAI compress SSE by default, which makes token extraction impossible
- `/v1` prefix is added to paths that omit it (Codex sends `/responses`, API expects `/v1/responses`)
- `Content-Length` and `Content-Type` are not set on GET/HEAD requests (some APIs reject them)
- **GET /responses is short-circuited** — returns empty list immediately without hitting OpenAI. Codex polls this on session start to check for resumable sessions; when it goes through the proxy it fails/hangs, causing a 2-minute reconnect loop. The empty response makes Codex skip session-resume and go straight to POST
- HTTPS keep-alive agents (`https.Agent({ keepAlive: true })`) reuse connections per provider to avoid repeated TLS handshakes
- `stream_options.include_usage` is only injected for Chat Completions — the Responses API doesn't support it and returns 400 if it's present

---

## 3. Tech Stack

| Component | Tech |
|---|---|
| Electron shell | Electron + electron-builder |
| Proxy Server | Node.js `http` / `https` modules (main process) |
| Emissions Math | Custom JS module |
| Database | NDJSON file (newline-delimited JSON, no native deps) |
| IPC / Stats bridge | Electron `ipcMain` / `ipcRenderer` |
| React Dashboard | React + Recharts + Tailwind (renderer) |
| System tray | Electron `Tray` API |
| Build tool | electron-vite + Vite |

### Why These Choices
- **Electron** — proxy is already Node.js; runs natively in the main process with zero extra overhead. Single distributable app, no terminal required.
- **NDJSON instead of SQLite** — avoids native binary compilation issues with Electron. Each event is a JSON line; query functions scan the file in memory.
- **Recharts** — declarative charts that work out of the box with React state
- **electron-builder** — packages the app as a `.dmg` (macOS) or `.exe` (Windows) for easy distribution

---

## 4. Emissions Calculation

Full methodology with citations: [tokens-methodology.md](tokens-methodology.md)

### Formula

```
co2Grams = (inputTokens + 3 × outputTokens) / 1000 × modelKwh × 386
```

- **3× output weighting:** Autoregressive decode generates one token per full forward pass (sequential). Prefill processes all input tokens in a single parallel pass. Özcan et al. (2025) Fig 3: decode-heavy workloads draw 2–4× more power than prefill-heavy at equivalent token counts. Samsi et al. (2023): LLaMA 65B costs 3–4 J per output token.
- **386 gCO₂/kWh:** US EIA national average. Consistent with Luccioni et al. BLOOM (394), Li et al. HotCarbon (380), Özcan et al. CAISO (418).

### Per-Model Energy Profiles (kWh per 1K output tokens)

| Model | kWh/1K output tokens | Source |
|---|---|---|
| Claude Haiku (all generations) | 0.00055 | carboncredits.com: 0.22 Wh / ~400 tokens (directly measured) |
| Claude Sonnet (all generations) | 0.00160 | Interpolated: ~3× Haiku via price ratio proxy |
| Claude Opus (all generations) | 0.01013 | carboncredits.com: 4.05 Wh / ~400 tokens (directly measured) |
| GPT-4o | 0.00060 | Epoch AI (2025): ~0.3 Wh / ~500 tokens; OpenAI: 0.34 Wh/query |
| GPT-4o-mini | 0.00012 | Price ratio proxy: ~5× cheaper than GPT-4o |
| GPT-4 / GPT-4-turbo | 0.00120 | ~2× GPT-4o (older architecture) |
| GPT-3.5-turbo | 0.00020 | Highly optimized, long-deployed |
| Gemini 2.5 Pro | 0.00080 | Price-tier proxy (premium) |
| Gemini 1.5 Pro | 0.00060 | Price-tier proxy (GPT-4o comparable) |
| Gemini Flash / 2.0 Flash | 0.00010–0.00012 | Price-tier proxy (mini tier) |
| Default (unknown model) | 0.00040 | 0.4 J/token modern estimate (clune.org 2025) × 1.2 PUE |

The difference between tiers is stark: Claude Opus uses **18× more energy** per token than Claude Haiku.

### Uncertainty

Estimates are shown with ±50% bounds:
- **Lower bound (0.5×):** Renewable grid (35 gCO₂/kWh per Li et al.) + optimized batching
- **Upper bound (2.5×):** Coal grid + unoptimized single-request serving + idle overhead (Luccioni: idle adds 46% on top of dynamic inference)

### What Is Not Included

- Embodied carbon from GPU manufacturing (~22% of lifecycle per Luccioni et al.)
- Idle serving overhead
- Prompt caching discounts (Anthropic cache reads cost ~10% of standard input rate)
- Network transmission

### Human-Readable Comparisons

- **km driven:** `co2Kg / 0.12` (EPA: avg car emits 0.12 kg CO₂/km)
- **phones charged:** `co2Kg / 0.011` (US DOE: smartphone charge ≈ 0.011 kg CO₂)
- **tree-days to offset:** `co2Kg / 0.0575` (EPA: one tree absorbs ~21 kg CO₂/year)
- **lightbulb hours:** `co2Kg / 0.0232` (60W bulb at 386 gCO₂/kWh)

---

## 5. Connection Management

### How Tools Are Connected

The Connection tab provides one-click connect/disconnect for each supported tool:

| Tool | Config file | Key written |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `env.ANTHROPIC_BASE_URL` |
| Codex CLI | `~/.codex/config.toml` | `openai_base_url` (top-level) + `OPENAI_BASE_URL` in `[shell_environment_policy.set]` |

`openai_base_url` must appear **before any `[section]` headers** in the TOML file or it gets parsed as part of that section.

### Lifecycle

- **On connect:** writes proxy URL to config, shows "Restart Now" button to kill the tool process so it picks up the change
- **On app quit (`before-quit`):** removes proxy URLs from all configs, kills Claude Code. Codex is not killed on quit — it crashes on SIGTERM instead of restarting gracefully.
- **Crash recovery:** on launch, checks for a stale PID file. If the previous process is dead (force-killed), runs cleanup before re-applying
- **Auto-reconnect:** on launch, re-applies proxy URLs for any tool that was connected last session (saved in `connection-prefs.json` in Electron userData)
- `process.on('exit', cleanup)` runs as a last-resort hook

### Codex-Specific Notes

- Codex crashes (SIGTERM) if killed via `pkill` — only Claude Code is auto-killed on reconnect/quit
- Codex's session initialization involves multiple GET /responses calls that fail through the proxy, causing a 2-minute reconnect loop on every new conversation. This is solved by short-circuiting GET /responses at the proxy level.
- Requires an OpenAI API key with `api.responses.write` scope explicitly enabled (new scope; old keys get 401)

---

## 6. Key Findings from Testing

### The Hidden Cost of AI Agents

A Codex session with 4 messages all saying "hi" shows **~12k input tokens per request**. The actual conversation is ~50 tokens. The rest is:
- Large system prompt describing agent behavior and rules
- Full JSON schemas for every tool (bash, file read/write, search, etc.)
- Shell environment state, memory files, loaded rules

This overhead is sent on **every single API call** regardless of message length. The API is stateless — there is no persistent context server-side.

### The Stateless API Problem

All major AI APIs are stateless. Every request resends the full conversation history:
- Turn 1: system prompt + tools + 1 message
- Turn 50: system prompt + tools + 50 messages

Long agentic sessions compound this dramatically.

---

## 7. Client Integration

### Claude Code
Handled automatically via the Connection tab. Manually:
```bash
# In ~/.claude/settings.json
{ "env": { "ANTHROPIC_BASE_URL": "http://localhost:3001" } }
```

### Codex CLI
Handled automatically via the Connection tab. Manually:
```toml
# At the TOP of ~/.codex/config.toml (before any [section])
openai_base_url = "http://localhost:3001"
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

**1. HTTP/2 upstream connections**
- Node.js `http2` module for multiplexed connections to api.openai.com / api.anthropic.com
- Would eliminate the per-request TLS handshake overhead and match direct connection performance

**2. Dynamic grid carbon intensity via ElectricityMaps API**
- Swap the hardcoded 386 gCO₂/kWh with live regional data

**3. Model recommendation engine**
- Analyze last 7 days and suggest cheaper/greener models

**4. Per-project / per-session tagging**
- `X-Session-ID` header support, UI to name sessions

**5. Carbon offset purchase flow**
- Integrate Wren or Terrapass API

**6. Export & sharing**
- CSV/JSON export, shareable monthly report

---

## 9. Pitch Notes

### Demo Flow

1. Launch TokenTrace — proxy starts, tray icon appears
2. Open Connection tab — click Connect for Claude Code, click Restart Now
3. Run a Claude Code session (this very conversation works as a demo)
4. Switch to Dashboard tab — show live token counts and CO₂ updating in real time
5. Point to the 12k token context window: "This is just the agent overhead, before you type anything"
6. Show model breakdown: "Switching to Haiku for these tasks saves 87% CO₂"

### Judging Criteria Alignment

| Criterion | How TokenTrace hits it |
|---|---|
| Sustainability impact | Direct measurement + offset pathway for AI's fastest-growing emission source |
| AI integration | Native one-click integration with Claude Code and Codex — works with any LLM tool |
| Technical depth | Proxy architecture, SSE parsing for two different APIs, lifecycle management, streaming keepalives |
| Novelty | No existing tool does provider-agnostic LLM carbon tracking as a native desktop app |
| Demo-ability | Live coding session → dashboard flow is visually compelling and reproducible |

### One-Sentence Answers to Hard Questions

- **"Why a desktop app and not a web app?"** — The proxy needs to run persistently in the background; a native app with a tray icon is the natural fit.
- **"Why a proxy and not a plugin?"** — A proxy works for every client without any code changes, including CLI tools and third-party apps.
- **"Are the emissions numbers accurate?"** — Estimates based on published research (Luccioni 2023); methodology is surfaced openly.
- **"What about privacy?"** — Everything runs locally. No data leaves your machine except to the LLM APIs you're already calling.
- **"Why does it not work with the Claude desktop app?"** — That app connects to claude.ai via OAuth, not the Anthropic API — there's no base URL to redirect.
- **"What's that 12k token overhead?"** — That's the agent framework itself: system prompt, tool definitions, shell state. TokenTrace makes this invisible cost visible.

---

*TokenTrace — Team Use Only*
