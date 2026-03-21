"use strict";
const electron = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const fs = require("fs");
let dbPath = null;
function getDbPath() {
  if (!dbPath) dbPath = path.join(electron.app.getPath("userData"), "tokentrace.ndjson");
  return dbPath;
}
function insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, sessionId }) {
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
    session_id: sessionId || null
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
    const day = new Date(r.timestamp).toISOString().slice(0, 10);
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
const MODEL_PROFILES = [
  // Anthropic
  { prefix: "claude-opus", kwh: 4e-3 },
  { prefix: "claude-sonnet", kwh: 15e-4 },
  { prefix: "claude-haiku", kwh: 3e-4 },
  { prefix: "claude-3-opus", kwh: 4e-3 },
  { prefix: "claude-3-5-sonnet", kwh: 15e-4 },
  { prefix: "claude-3-5-haiku", kwh: 3e-4 },
  { prefix: "claude-3-sonnet", kwh: 15e-4 },
  { prefix: "claude-3-haiku", kwh: 3e-4 },
  // OpenAI
  { prefix: "o3", kwh: 8e-3 },
  { prefix: "o1", kwh: 4e-3 },
  { prefix: "gpt-4o-mini", kwh: 3e-4 },
  { prefix: "gpt-4o", kwh: 15e-4 },
  { prefix: "gpt-4", kwh: 4e-3 },
  { prefix: "gpt-3.5", kwh: 3e-4 }
];
const GRID_INTENSITY_G_PER_KWH = 386;
function getModelKwh(model) {
  if (!model) return 1e-3;
  const lower = model.toLowerCase();
  for (const profile of MODEL_PROFILES) {
    if (lower.startsWith(profile.prefix)) return profile.kwh;
  }
  return 1e-3;
}
function calculateEmissions(model, inputTokens, outputTokens) {
  const modelKwh = getModelKwh(model);
  const weightedTokens = inputTokens + outputTokens * 3;
  const energyKwh = weightedTokens / 1e3 * modelKwh;
  const co2Grams = energyKwh * GRID_INTENSITY_G_PER_KWH;
  const comparisons = {
    // meters driven in an average car (~120 gCO₂/km)
    carMeters: Math.round(co2Grams / 120 * 1e3),
    // phone charge percentage points (~0.05 gCO₂/%)
    phoneChargePercent: Math.round(co2Grams / 0.05),
    // seconds of HD video streaming (~0.017 gCO₂/s)
    videoSeconds: Math.round(co2Grams * 60),
    // seconds for one tree to absorb this CO₂ (~57.5 g/day)
    treeSeconds: Math.round(co2Grams / 57.5 * 86400)
  };
  return { energyKwh, co2Grams, comparisons, modelKwh };
}
const ANTHROPIC_HOST = "api.anthropic.com";
const OPENAI_HOST = "api.openai.com";
const PROXY_PORT = 3001;
let emitToRenderer = null;
function setEmitter(fn) {
  emitToRenderer = fn;
}
function detectProvider(req) {
  const headerProvider = req.headers["x-provider"];
  if (headerProvider === "anthropic") return "anthropic";
  if (headerProvider === "openai") return "openai";
  if (req.url.startsWith("/messages") || req.url.startsWith("/v1/messages")) return "anthropic";
  if (req.url.startsWith("/chat/completions") || req.url.startsWith("/v1/chat/completions")) return "openai";
  const auth = req.headers["authorization"] || "";
  const key = auth.replace(/^Bearer\s+/i, "");
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-")) return "openai";
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
      if (evt.usage && evt.model && !evt.type) {
        model = evt.model || "";
        inputTokens = evt.usage.input_tokens || 0;
        outputTokens = evt.usage.output_tokens || 0;
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
      model = model || evt.model || "";
      if (evt.usage) {
        inputTokens = evt.usage.prompt_tokens || 0;
        outputTokens = evt.usage.completion_tokens || 0;
      }
    } catch (_) {
    }
  }
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString());
      model = parsed.model || "";
      inputTokens = parsed.usage?.prompt_tokens || 0;
      outputTokens = parsed.usage?.completion_tokens || 0;
    } catch (_) {
    }
  }
  return { inputTokens, outputTokens, model };
}
function logAndEmit({ provider, model, inputTokens, outputTokens, sessionId }) {
  if (!inputTokens && !outputTokens) return;
  try {
    const { energyKwh, co2Grams, comparisons } = calculateEmissions(model, inputTokens, outputTokens);
    insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, sessionId });
    if (emitToRenderer) {
      emitToRenderer({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, comparisons, timestamp: Date.now() });
    }
  } catch (err) {
    console.error("[tokentrace] logAndEmit error:", err);
  }
}
function createProxyServer() {
  const server = http.createServer((req, res) => {
    const provider = detectProvider(req);
    const upstreamHost = provider === "anthropic" ? ANTHROPIC_HOST : OPENAI_HOST;
    const sessionId = req.headers["x-session-id"] || null;
    const reqChunks = [];
    req.on("data", (chunk) => reqChunks.push(chunk));
    req.on("end", () => {
      let bodyBuf = Buffer.concat(reqChunks);
      if (provider === "openai") {
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
      upstreamHeaders["content-length"] = bodyBuf.length;
      const options = {
        hostname: upstreamHost,
        port: 443,
        path: req.url,
        method: req.method,
        headers: upstreamHeaders
      };
      const upstreamReq = https.request(options, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        const resChunks = [];
        upstreamRes.on("data", (chunk) => {
          res.write(chunk);
          resChunks.push(chunk);
        });
        upstreamRes.on("end", () => {
          res.end();
          const fullBuf = Buffer.concat(resChunks);
          const extract = provider === "anthropic" ? extractAnthropicTokens : extractOpenAITokens;
          const { inputTokens, outputTokens, model } = extract(fullBuf);
          logAndEmit({ provider, model, inputTokens, outputTokens, sessionId });
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
let mainWindow = null;
let tray = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f172a",
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
  const updateMenu = () => {
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
  };
  tray.setToolTip("TokenTrace");
  tray.on("click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  updateMenu();
}
function registerIPC() {
  electron.ipcMain.handle("get-stats", (_e, opts) => getStats(opts));
  electron.ipcMain.handle("get-daily", (_e, opts) => getDailyStats(opts));
  electron.ipcMain.handle("get-events", (_e, limit) => getRecentEvents(limit));
  electron.ipcMain.handle("get-proxy-port", () => PROXY_PORT);
  electron.ipcMain.handle("open-external", (_e, url) => electron.shell.openExternal(url));
}
electron.app.whenReady().then(() => {
  createWindow();
  createTray();
  registerIPC();
  createProxyServer();
  setEmitter((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("usage-event", event);
    }
  });
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
electron.app.on("before-quit", () => {
  electron.app.isQuiting = true;
});
