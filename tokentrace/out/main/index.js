"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const child_process = require("child_process");
const https = require("https");
let dbPath = null;
function getDbPath() {
  if (!dbPath) dbPath = path.join(electron.app.getPath("userData"), "tokentrace.ndjson");
  return dbPath;
}
function insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, sessionId, compressionStats }) {
  const row = {
    id: Date.now() + Math.random(),
    timestamp: Date.now(),
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    energy_kwh: energyKwh,
    co2_grams: co2Grams,
    session_id: sessionId || null,
    compressionStats: compressionStats || null
  };
  fs.appendFileSync(getDbPath(), JSON.stringify(row) + "\n", "utf8");
  return row;
}
function readAll() {
  try {
    const raw = fs.readFileSync(getDbPath(), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}
function getStats({ since, provider } = {}) {
  const sinceTs = since ? Date.now() - since : 0;
  let rows = readAll().filter((r) => r.timestamp >= sinceTs);
  if (provider) rows = rows.filter((r) => r.provider === provider);
  const totals = rows.reduce(
    (acc, r) => {
      acc.callCount++;
      acc.totalInput += r.input_tokens || 0;
      acc.totalOutput += r.output_tokens || 0;
      acc.totalTokens += r.total_tokens || 0;
      acc.totalEnergy += r.energy_kwh || 0;
      acc.totalCo2 += r.co2_grams || 0;
      return acc;
    },
    { callCount: 0, totalInput: 0, totalOutput: 0, totalTokens: 0, totalEnergy: 0, totalCo2: 0 }
  );
  const modelMap = {};
  for (const r of rows) {
    if (!modelMap[r.model]) modelMap[r.model] = { model: r.model, provider: r.provider, calls: 0, tokens: 0, co2: 0 };
    modelMap[r.model].calls++;
    modelMap[r.model].tokens += r.total_tokens || 0;
    modelMap[r.model].co2 += r.co2_grams || 0;
  }
  const byModel = Object.values(modelMap).sort((a, b) => b.co2 - a.co2);
  return { totals, byModel };
}
function getDailyStats({ days = 30 } = {}) {
  const since = Date.now() - days * 86400 * 1e3;
  const rows = readAll().filter((r) => r.timestamp >= since);
  const dayMap = {};
  for (const r of rows) {
    const d = new Date(r.timestamp);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!dayMap[day]) dayMap[day] = { day, co2: 0, tokens: 0, calls: 0 };
    dayMap[day].co2 += r.co2_grams || 0;
    dayMap[day].tokens += r.total_tokens || 0;
    dayMap[day].calls++;
  }
  return Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day));
}
function getRecentEvents(limit = 50) {
  return readAll().slice(-limit).reverse();
}
const MODEL_KWH_PER_1K = {
  // ── Anthropic Claude ──────────────────────────────────────────────────────
  "claude-haiku-4": 55e-5,
  "claude-3-5-haiku": 55e-5,
  "claude-3-haiku": 55e-5,
  "claude-haiku": 55e-5,
  "claude-sonnet-4": 16e-4,
  "claude-3-7-sonnet": 16e-4,
  "claude-3-5-sonnet": 16e-4,
  "claude-3-sonnet": 16e-4,
  "claude-sonnet": 16e-4,
  "claude-opus-4": 0.01013,
  "claude-3-opus": 0.01013,
  "claude-opus": 0.01013,
  // ── OpenAI GPT ────────────────────────────────────────────────────────────
  "gpt-4o-mini": 12e-5,
  "gpt-4o": 6e-4,
  "gpt-4-turbo": 12e-4,
  "gpt-4": 12e-4,
  "gpt-3.5-turbo": 2e-4,
  "gpt-3.5": 2e-4,
  // ── OpenAI reasoning models ───────────────────────────────────────────────
  "o3-mini": 6e-4,
  "o3": 24e-4,
  "o1-mini": 6e-4,
  "o1": 12e-4,
  // ── Google Gemini ─────────────────────────────────────────────────────────
  "gemini-2.5-pro": 8e-4,
  "gemini-2.0-flash": 1e-4,
  "gemini-1.5-flash": 12e-5,
  "gemini-1.5-pro": 6e-4,
  // ── GPT-5 Codex (OpenAI Codex CLI) ───────────────────────────────────────
  "gpt-5": 6e-4,
  // treat as GPT-4o tier until data available
  // ── Fallback ──────────────────────────────────────────────────────────────
  "default": 4e-4
};
const GRID_G_CO2_PER_KWH = 386;
function getModelKwh(model) {
  if (!model || typeof model !== "string") return MODEL_KWH_PER_1K["default"];
  const lower = model.toLowerCase().trim();
  for (const key of Object.keys(MODEL_KWH_PER_1K)) {
    if (key === "default") continue;
    if (lower.startsWith(key) || lower.includes(key)) return MODEL_KWH_PER_1K[key];
  }
  return MODEL_KWH_PER_1K["default"];
}
function calculateEmissions(model, inputTokens, outputTokens) {
  const modelKwh = getModelKwh(model);
  const weightedTokens = (inputTokens || 0) + 3 * (outputTokens || 0);
  const energyKwh = weightedTokens / 1e3 * modelKwh;
  const co2Grams = energyKwh * GRID_G_CO2_PER_KWH;
  const comparisons = {
    // EPA: average car emits 0.12 kg CO₂/km → meters
    carMeters: Math.round(co2Grams / 1e3 / 0.12 * 1e3),
    // US DOE: smartphone charge ≈ 0.011 kg CO₂ → % of charge
    phoneChargePercent: +(co2Grams / 1e3 / 0.011 * 100).toFixed(2),
    // EPA: one tree absorbs ~21 kg CO₂/year = ~0.0575 kg/day → tree-days
    treeDaysNeeded: +(co2Grams / 1e3 / 0.0575).toFixed(4),
    // 60W bulb at 386 gCO₂/kWh → hours
    lightbulbHours: +(co2Grams / 1e3 / 0.0232).toFixed(4)
  };
  return { energyKwh, co2Grams, comparisons, modelKwh };
}
const anthropicAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const openaiAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const geminiAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
const ANTHROPIC_HOST = "api.anthropic.com";
const OPENAI_HOST = "api.openai.com";
const GEMINI_HOST = "generativelanguage.googleapis.com";
const PROXY_PORT = 3001;
let emitToRenderer = null;
let compressionEnabled = false;
const COMPRESS_THRESHOLD = 600;
const COMPRESS_CEILING = 3e3;
const COMPRESS_SYSTEM = `You are a prompt compressor. Rewrite the user message to be as concise as possible.
Rules:
1. NEVER modify technical content: code, commands, error messages, numbers, filenames, library names, URLs, version numbers, configs, stack traces, variable names, data structures
2. REMOVE human conversational elements: greetings, hedging phrases ("I think", "maybe", "kind of"), narrative structure, politeness, repetition, and filler words
3. KEEP all technical requirements, constraints, questions, and context
4. Output ONLY the rewritten message — no preamble, no explanation`;
function setEmitter(fn) {
  emitToRenderer = fn;
}
function setCompressionEnabled(val) {
  compressionEnabled = val;
}
async function compressUserMessage(content, provider, apiKey) {
  console.log(`[compress] sending to ${provider}, keyLen=${apiKey?.length ?? 0}, contentLen=${content.length}`);
  try {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: COMPRESS_SYSTEM,
          messages: [{ role: "user", content }]
        }),
        signal: AbortSignal.timeout(3e4)
      });
      const data = await res.json();
      console.log(`[compress] anthropic response: status=${res.status} type=${data.type} resultLen=${data.content?.[0]?.text?.length ?? "n/a"}`);
      if (data.error) console.error("[compress] anthropic api error:", JSON.stringify(data.error));
      return data.content?.[0]?.text || content;
    } else if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: COMPRESS_SYSTEM },
            { role: "user", content }
          ]
        }),
        signal: AbortSignal.timeout(3e4)
      });
      const data = await res.json();
      console.log(`[compress] openai response: status=${res.status} resultLen=${data.choices?.[0]?.message?.content?.length ?? "n/a"}`);
      if (data.error) console.error("[compress] openai api error:", JSON.stringify(data.error));
      return data.choices?.[0]?.message?.content || content;
    }
  } catch (err) {
    console.error("[compress] fetch error:", err.message);
  }
  return content;
}
function detectProvider(req) {
  const headerProvider = req.headers["x-provider"];
  if (headerProvider === "anthropic") return "anthropic";
  if (headerProvider === "openai") return "openai";
  if (req.url.startsWith("/messages") || req.url.startsWith("/v1/messages")) return "anthropic";
  if (req.url.startsWith("/chat/completions") || req.url.startsWith("/v1/chat/completions")) return "openai";
  if (req.url.startsWith("/responses") || req.url.startsWith("/v1/responses")) return "openai";
  if (req.url.includes("generateContent") || req.url.includes("streamGenerateContent") || req.url.startsWith("/v1beta/") || req.url.startsWith("/v1/models/")) return "gemini";
  const auth = req.headers["authorization"] || "";
  const key = auth.replace(/^Bearer\s+/i, "");
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
  const googleKey = req.headers["x-goog-api-key"] || "";
  if (googleKey.startsWith("AIza")) return "gemini";
  return "anthropic";
}
function extractAnthropicTokens(buffer) {
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "";
  const lines = buffer.toString().split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") continue;
    try {
      const evt = JSON.parse(raw);
      if (evt.type === "message_start" && evt.message) {
        model = evt.message.model || "";
        inputTokens = evt.message.usage?.input_tokens || 0;
      }
      if (evt.type === "message_delta" && evt.usage) {
        outputTokens = evt.usage.output_tokens || 0;
      }
      if ((evt.type === "response.completed" || evt.type === "response.done") && evt.response) {
        model = evt.response.model || model;
        inputTokens = evt.response.usage?.input_tokens || inputTokens;
        outputTokens = evt.response.usage?.output_tokens || outputTokens;
      }
      if (evt.type === "response.created" && evt.response) {
        model = evt.response.model || model;
      }
      if (evt.usage && evt.model && !evt.type) {
        model = evt.model || "";
        inputTokens = evt.usage.input_tokens || 0;
        outputTokens = evt.usage.output_tokens || 0;
      }
    } catch (_) {
    }
  }
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString());
      if (parsed.usage && parsed.model) {
        model = parsed.model;
        inputTokens = parsed.usage.input_tokens || 0;
        outputTokens = parsed.usage.output_tokens || 0;
      }
    } catch (_) {
    }
  }
  return { inputTokens, outputTokens, model };
}
function extractOpenAITokens(buffer) {
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "";
  const lines = buffer.toString().split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (raw === "[DONE]") continue;
    try {
      const evt = JSON.parse(raw);
      model = model || evt.model || evt.response?.model || "";
      if (evt.usage) {
        inputTokens = evt.usage.prompt_tokens || evt.usage.input_tokens || 0;
        outputTokens = evt.usage.completion_tokens || evt.usage.output_tokens || 0;
      }
      if (evt.type === "response.completed" && evt.response?.usage) {
        model = evt.response.model || model;
        inputTokens = evt.response.usage.input_tokens || 0;
        outputTokens = evt.response.usage.output_tokens || 0;
      }
    } catch (_) {
    }
  }
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString());
      model = parsed.model || "";
      inputTokens = parsed.usage?.prompt_tokens || parsed.usage?.input_tokens || 0;
      outputTokens = parsed.usage?.completion_tokens || parsed.usage?.output_tokens || 0;
    } catch (_) {
    }
  }
  return { inputTokens, outputTokens, model };
}
function extractGeminiTokens(buffer, reqUrl) {
  let inputTokens = 0;
  let outputTokens = 0;
  let model = "";
  const modelMatch = (reqUrl || "").match(/\/models\/([^/:?]+)/);
  if (modelMatch) model = modelMatch[1];
  const lines = buffer.toString().split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const evt = JSON.parse(raw);
      if (evt.usageMetadata) {
        inputTokens = evt.usageMetadata.promptTokenCount || inputTokens;
        outputTokens = evt.usageMetadata.candidatesTokenCount || outputTokens;
        model = evt.modelVersion || model;
      }
    } catch (_) {
    }
  }
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString());
      if (parsed.usageMetadata) {
        inputTokens = parsed.usageMetadata.promptTokenCount || 0;
        outputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
        model = parsed.modelVersion || model;
      }
    } catch (_) {
    }
  }
  return { inputTokens, outputTokens, model };
}
function logAndEmit({ provider, model, inputTokens, outputTokens, sessionId, compressionStats }) {
  if (!inputTokens && !outputTokens) return;
  try {
    const { energyKwh, co2Grams, comparisons } = calculateEmissions(model, inputTokens, outputTokens);
    insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, sessionId, compressionStats });
    if (emitToRenderer) {
      emitToRenderer({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, comparisons, compressionStats, timestamp: Date.now() });
    }
  } catch (err) {
    console.error("[tokentrace] logAndEmit error:", err);
  }
}
function createProxyServer() {
  const server = http.createServer((req, res) => {
    const provider = detectProvider(req);
    const upstreamHost = provider === "anthropic" ? ANTHROPIC_HOST : provider === "gemini" ? GEMINI_HOST : OPENAI_HOST;
    const sessionId = req.headers["x-session-id"] || null;
    console.log(`[proxy] ${req.method} ${req.url} → ${upstreamHost} (provider: ${provider})`);
    if (req.method === "GET" && req.url.startsWith("/responses")) {
      const empty = JSON.stringify({ object: "list", data: [], has_more: false });
      res.writeHead(200, { "content-type": "application/json", "content-length": empty.length });
      res.end(empty);
      return;
    }
    const reqChunks = [];
    req.on("data", (chunk) => reqChunks.push(chunk));
    req.on("end", async () => {
      let bodyBuf = Buffer.concat(reqChunks);
      let compressionStats = null;
      if (compressionEnabled && provider !== "gemini" && req.method === "POST") {
        try {
          const parsed = JSON.parse(bodyBuf.toString());
          const messages = parsed.messages || [];
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          let original = null;
          let isArray = false;
          let targetBlock = null;
          if (lastUser) {
            if (typeof lastUser.content === "string") {
              original = lastUser.content;
            } else if (Array.isArray(lastUser.content)) {
              const textBlocks = lastUser.content.filter((b) => b.type === "text" && b.text);
              if (textBlocks.length > 0) {
                targetBlock = textBlocks[textBlocks.length - 1];
                original = targetBlock.text;
                isArray = true;
              }
            }
          }
          const hasInjectedContext = original && /<(system-reminder|ide_opened_file|ide_selection)\b/.test(original);
          if (original && original.length > COMPRESS_THRESHOLD && original.length <= COMPRESS_CEILING && !hasInjectedContext) {
            const apiKey = provider === "anthropic" ? req.headers["x-api-key"] || (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "") : (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
            const compressed = await compressUserMessage(original, provider, apiKey);
            if (compressed && compressed !== original && compressed.length < original.length) {
              if (isArray && targetBlock) {
                targetBlock.text = compressed;
              } else {
                lastUser.content = compressed;
              }
              bodyBuf = Buffer.from(JSON.stringify(parsed));
              compressionStats = { originalChars: original.length, compressedChars: compressed.length };
              const origTokens = Math.ceil(original.length / 4);
              const compTokens = Math.ceil(compressed.length / 4);
              console.log([
                "─".repeat(60),
                `[compress] ${provider} · −${origTokens - compTokens} tokens (${Math.round((1 - compressed.length / original.length) * 100)}% reduction)`,
                `  ORIGINAL  (~${origTokens} tok): ${original}`,
                `  COMPRESSED (~${compTokens} tok): ${compressed}`,
                "─".repeat(60)
              ].join("\n"));
            }
          }
        } catch (err) {
          console.error("[compress] parse error:", err.message);
        }
      }
      if (provider === "openai" && req.url.includes("/chat/completions")) {
        try {
          const parsed = JSON.parse(bodyBuf.toString());
          if (parsed.stream) {
            parsed.stream_options = { include_usage: true };
            bodyBuf = Buffer.from(JSON.stringify(parsed));
          }
        } catch (_) {
        }
      }
      const upstreamHeaders = { ...req.headers };
      upstreamHeaders["host"] = upstreamHost;
      delete upstreamHeaders["x-provider"];
      delete upstreamHeaders["x-session-id"];
      delete upstreamHeaders["accept-encoding"];
      if (req.method === "GET" || req.method === "HEAD") {
        delete upstreamHeaders["content-length"];
        delete upstreamHeaders["content-type"];
      } else {
        upstreamHeaders["content-length"] = bodyBuf.length;
      }
      const upstreamPath = provider === "gemini" || req.url.startsWith("/v1") ? req.url : "/v1" + req.url;
      const options = {
        hostname: upstreamHost,
        port: 443,
        path: upstreamPath,
        method: req.method,
        headers: upstreamHeaders,
        agent: provider === "anthropic" ? anthropicAgent : provider === "gemini" ? geminiAgent : openaiAgent
      };
      let keepaliveTimer = null;
      const isStreaming = req.method === "POST" && (req.url.includes("responses") || req.url.includes("messages") || req.url.includes("streamGenerateContent"));
      if (isStreaming) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive"
        });
        keepaliveTimer = setInterval(() => {
          if (!res.writableEnded) res.write(": keepalive\n\n");
        }, 5e3);
      }
      const upstreamReq = https.request(options, (upstreamRes) => {
        if (!isStreaming) res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        const resChunks = [];
        upstreamRes.on("data", (chunk) => {
          res.write(chunk);
          resChunks.push(chunk);
        });
        upstreamRes.on("end", () => {
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
          }
          res.end();
          const fullBuf = Buffer.concat(resChunks);
          const extract = provider === "anthropic" ? extractAnthropicTokens : provider === "gemini" ? (buf) => extractGeminiTokens(buf, req.url) : extractOpenAITokens;
          const { inputTokens, outputTokens, model } = extract(fullBuf);
          logAndEmit({ provider, model, inputTokens, outputTokens, sessionId, compressionStats });
        });
      });
      upstreamReq.on("error", (err) => {
        console.error("[tokentrace] upstream error:", err.message);
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(JSON.stringify({ error: "TokenTrace proxy upstream error", detail: err.message }));
        }
      });
      upstreamReq.write(bodyBuf);
      upstreamReq.end();
    });
  });
  server.listen(PROXY_PORT, "127.0.0.1", () => {
    console.log(`[tokentrace] proxy listening on http://127.0.0.1:${PROXY_PORT}`);
  });
  return server;
}
const EXTENSION_PORT = 3002;
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const CODEX_CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");
const GEMINI_ENV_PATH = path.join(os.homedir(), ".env");
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
let PREFS_PATH = null;
let PID_PATH = null;
const DEFAULT_PREFS = { claudeCode: false, codex: false, gemini: false, compression: false };
function readPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(PREFS_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
function writePrefs(prefs) {
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}
function readClaudeSettings() {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}
function writeClaudeSettings(settings) {
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
function applyClaudeCode() {
  const settings = readClaudeSettings();
  settings.env = { ...settings.env || {}, ANTHROPIC_BASE_URL: PROXY_URL };
  writeClaudeSettings(settings);
}
function removeClaudeCode() {
  const settings = readClaudeSettings();
  if (settings.env) {
    delete settings.env.ANTHROPIC_BASE_URL;
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }
  writeClaudeSettings(settings);
}
function getCodexBaseUrl() {
  try {
    const content = fs.readFileSync(CODEX_CONFIG_PATH, "utf8");
    const match = content.match(/^openai_base_url\s*=\s*"([^"]+)"/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
function applyCodex() {
  fs.mkdirSync(path.dirname(CODEX_CONFIG_PATH), { recursive: true });
  let content = "";
  try {
    content = fs.readFileSync(CODEX_CONFIG_PATH, "utf8");
  } catch {
  }
  if (/^openai_base_url\s*=/m.test(content)) {
    content = content.replace(/^openai_base_url\s*=.*\n?/m, `openai_base_url = "${PROXY_URL}"
`);
  } else {
    content = `openai_base_url = "${PROXY_URL}"
` + (content ? "\n" + content : "");
  }
  if (/^\[shell_environment_policy\.set\]/m.test(content)) {
    if (/^OPENAI_BASE_URL\s*=/m.test(content)) {
      content = content.replace(/^OPENAI_BASE_URL\s*=.*/m, `OPENAI_BASE_URL = "${PROXY_URL}"`);
    } else {
      content = content.replace(
        /^(\[shell_environment_policy\.set\])/m,
        `$1
OPENAI_BASE_URL = "${PROXY_URL}"`
      );
    }
  }
  fs.writeFileSync(CODEX_CONFIG_PATH, content);
}
function getGeminiBaseUrl() {
  try {
    const content = fs.readFileSync(GEMINI_ENV_PATH, "utf8");
    const match = content.match(/^GEMINI_BASE_URL=(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}
function applyGemini() {
  let content = "";
  try {
    content = fs.readFileSync(GEMINI_ENV_PATH, "utf8");
  } catch {
  }
  if (/^GEMINI_BASE_URL=/m.test(content)) {
    content = content.replace(/^GEMINI_BASE_URL=.*/m, `GEMINI_BASE_URL=${PROXY_URL}`);
  } else {
    content = content.trimEnd() + (content ? "\n" : "") + `GEMINI_BASE_URL=${PROXY_URL}
`;
  }
  fs.writeFileSync(GEMINI_ENV_PATH, content);
}
function removeGemini() {
  try {
    let content = fs.readFileSync(GEMINI_ENV_PATH, "utf8");
    content = content.replace(/^GEMINI_BASE_URL=.*\n?/m, "");
    fs.writeFileSync(GEMINI_ENV_PATH, content);
  } catch {
  }
}
function removeCodex() {
  try {
    let content = fs.readFileSync(CODEX_CONFIG_PATH, "utf8");
    content = content.replace(/^openai_base_url\s*=.*\n?/m, "");
    content = content.replace(/^OPENAI_BASE_URL\s*=.*\n?/m, "");
    fs.writeFileSync(CODEX_CONFIG_PATH, content);
  } catch {
  }
}
let mainWindow = null;
let tray = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#052e16",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../out/renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (e) => {
    if (!electron.app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}
function createTray() {
  const icon = electron.nativeImage.createEmpty();
  tray = new electron.Tray(icon);
  tray.setContextMenu(electron.Menu.buildFromTemplate([
    { label: "Open TokenTrace", click: () => {
      mainWindow.show();
      mainWindow.focus();
    } },
    { type: "separator" },
    { label: `Proxy: localhost:${PROXY_PORT}`, enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => {
      electron.app.isQuiting = true;
      electron.app.quit();
    } }
  ]));
  tray.setToolTip("TokenTrace");
  tray.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}
function registerIPC() {
  electron.ipcMain.handle("get-stats", (_e, opts) => getStats(opts));
  electron.ipcMain.handle("get-daily", (_e, opts) => getDailyStats(opts));
  electron.ipcMain.handle("get-events", (_e, limit) => getRecentEvents(limit));
  electron.ipcMain.handle("get-proxy-port", () => PROXY_PORT);
  electron.ipcMain.handle("open-external", (_e, url) => electron.shell.openExternal(url));
  electron.ipcMain.handle("get-connection-status", () => {
    const settings = readClaudeSettings();
    const connected = settings?.env?.ANTHROPIC_BASE_URL === PROXY_URL;
    return { connected, currentValue: settings?.env?.ANTHROPIC_BASE_URL ?? null };
  });
  electron.ipcMain.handle("get-codex-status", () => {
    const current = getCodexBaseUrl();
    return { connected: current === PROXY_URL, currentValue: current };
  });
  electron.ipcMain.handle("connect-claude-code", () => {
    applyClaudeCode();
    const prefs = readPrefs();
    prefs.claudeCode = true;
    writePrefs(prefs);
    return { ok: true };
  });
  electron.ipcMain.handle("disconnect-claude-code", () => {
    removeClaudeCode();
    const prefs = readPrefs();
    prefs.claudeCode = false;
    writePrefs(prefs);
    return { ok: true };
  });
  electron.ipcMain.handle("connect-codex", () => {
    applyCodex();
    const prefs = readPrefs();
    prefs.codex = true;
    writePrefs(prefs);
    return { ok: true };
  });
  electron.ipcMain.handle("disconnect-codex", () => {
    removeCodex();
    const prefs = readPrefs();
    prefs.codex = false;
    writePrefs(prefs);
    return { ok: true };
  });
  electron.ipcMain.handle("get-gemini-status", () => {
    const current = getGeminiBaseUrl();
    return { connected: current === PROXY_URL, currentValue: current };
  });
  electron.ipcMain.handle("connect-gemini", () => {
    applyGemini();
    const prefs = readPrefs();
    prefs.gemini = true;
    writePrefs(prefs);
    return { ok: true };
  });
  electron.ipcMain.handle("disconnect-gemini", () => {
    removeGemini();
    const prefs = readPrefs();
    prefs.gemini = false;
    writePrefs(prefs);
    return { ok: true };
  });
  electron.ipcMain.handle(
    "restart-claude-code",
    () => new Promise((resolve) => child_process.exec('pkill -f "claude"', () => resolve({ ok: true })))
  );
  electron.ipcMain.handle(
    "restart-codex",
    () => new Promise((resolve) => child_process.exec('pkill -f "codex"', () => resolve({ ok: true })))
  );
  electron.ipcMain.handle(
    "restart-gemini",
    () => new Promise((resolve) => child_process.exec('pkill -f "gemini"', () => resolve({ ok: true })))
  );
  electron.ipcMain.handle("get-prefs", () => readPrefs());
  electron.ipcMain.handle("get-compression-enabled", () => readPrefs().compression);
  electron.ipcMain.handle("set-compression-enabled", (_e, val) => {
    setCompressionEnabled(val);
    const prefs = readPrefs();
    prefs.compression = val;
    writePrefs(prefs);
    return { ok: true };
  });
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function startExtensionReceiver(emitFn) {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/event") {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        try {
          const { provider, model, inputTokens, outputTokens } = JSON.parse(body);
          if (inputTokens || outputTokens) {
            const { energyKwh, co2Grams, comparisons } = calculateEmissions(model, inputTokens, outputTokens);
            insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams });
            if (emitFn) {
              emitFn({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, comparisons, timestamp: Date.now() });
            }
          }
          res.writeHead(200);
          res.end("ok");
        } catch (_) {
          res.writeHead(400);
          res.end("bad request");
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(EXTENSION_PORT, "127.0.0.1", () => {
    console.log(`[tokentrace] extension receiver on http://127.0.0.1:${EXTENSION_PORT}`);
  });
  return server;
}
electron.app.whenReady().then(() => {
  const userData = electron.app.getPath("userData");
  PREFS_PATH = path.join(userData, "connection-prefs.json");
  PID_PATH = path.join(userData, "app.pid");
  try {
    const oldPid = parseInt(fs.readFileSync(PID_PATH, "utf8"));
    if (!isProcessAlive(oldPid)) {
      removeClaudeCode();
      removeCodex();
      removeGemini();
    }
  } catch {
  }
  fs.writeFileSync(PID_PATH, String(process.pid));
  createWindow();
  createTray();
  registerIPC();
  const prefs = readPrefs();
  if (prefs.claudeCode) {
    applyClaudeCode();
    child_process.exec('pkill -f "claude"');
  }
  if (prefs.codex) {
    applyCodex();
  }
  if (prefs.gemini) {
    applyGemini();
  }
  if (prefs.compression) {
    setCompressionEnabled(true);
  }
  const emitUsageEvent = (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("usage-event", event);
    }
  };
  createProxyServer();
  setEmitter(emitUsageEvent);
  startExtensionReceiver(emitUsageEvent);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});
electron.app.on("window-all-closed", () => {
});
function cleanup() {
  removeClaudeCode();
  removeCodex();
  removeGemini();
  try {
    if (PID_PATH) fs.unlinkSync(PID_PATH);
  } catch {
  }
}
electron.app.on("before-quit", () => {
  electron.app.isQuiting = true;
  cleanup();
  const prefs = readPrefs();
  if (prefs.claudeCode) child_process.exec('pkill -f "claude"');
});
process.on("exit", cleanup);
