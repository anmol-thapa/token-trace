import http from 'http'
import https from 'https'

const anthropicAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
const openaiAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
import { insertEvent } from './db'
import { calculateEmissions } from './emissions'

const ANTHROPIC_HOST = 'api.anthropic.com'
const OPENAI_HOST = 'api.openai.com'
const PROXY_PORT = 3001

let emitToRenderer = null // set by main.js after window is created

function setEmitter(fn) {
  emitToRenderer = fn
}

// Detect which upstream provider to use
function detectProvider(req) {
  // 1. Explicit header override
  const headerProvider = req.headers['x-provider']
  if (headerProvider === 'anthropic') return 'anthropic'
  if (headerProvider === 'openai') return 'openai'

  // 2. Request path
  if (req.url.startsWith('/messages') || req.url.startsWith('/v1/messages')) return 'anthropic'
  if (req.url.startsWith('/chat/completions') || req.url.startsWith('/v1/chat/completions')) return 'openai'
  if (req.url.startsWith('/responses') || req.url.startsWith('/v1/responses')) return 'openai'

  // 3. API key prefix
  const auth = req.headers['authorization'] || ''
  const key = auth.replace(/^Bearer\s+/i, '')
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('sk-')) return 'openai'

  return 'anthropic' // fallback
}

// Parse SSE chunks and extract token usage
function extractAnthropicTokens(buffer) {
  let inputTokens = 0
  let outputTokens = 0
  let model = ''

  const lines = buffer.toString().split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim()
    if (raw === '[DONE]') continue
    try {
      const evt = JSON.parse(raw)
      // Messages API: message_start has input tokens + model
      if (evt.type === 'message_start' && evt.message) {
        model = evt.message.model || ''
        inputTokens = evt.message.usage?.input_tokens || 0
      }
      // Messages API: message_delta has output tokens
      if (evt.type === 'message_delta' && evt.usage) {
        outputTokens = evt.usage.output_tokens || 0
      }
      // Responses API streaming: response.completed or response.created
      if ((evt.type === 'response.completed' || evt.type === 'response.done') && evt.response) {
        model = evt.response.model || model
        inputTokens = evt.response.usage?.input_tokens || inputTokens
        outputTokens = evt.response.usage?.output_tokens || outputTokens
      }
      // Responses API: delta events carry model
      if (evt.type === 'response.created' && evt.response) {
        model = evt.response.model || model
      }
      // Non-streaming response (Messages or Responses API)
      if (evt.usage && evt.model && !evt.type) {
        model = evt.model || ''
        inputTokens = evt.usage.input_tokens || 0
        outputTokens = evt.usage.output_tokens || 0
      }
    } catch (_) { /* not JSON, skip */ }
  }

  // Non-streaming Responses API JSON body
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString())
      if (parsed.usage && parsed.model) {
        model = parsed.model
        inputTokens = parsed.usage.input_tokens || 0
        outputTokens = parsed.usage.output_tokens || 0
      }
    } catch (_) { /* streaming, already handled */ }
  }

  return { inputTokens, outputTokens, model }
}

function extractOpenAITokens(buffer) {
  let inputTokens = 0
  let outputTokens = 0
  let model = ''

  const lines = buffer.toString().split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim()
    if (raw === '[DONE]') continue
    try {
      const evt = JSON.parse(raw)
      model = model || evt.model || evt.response?.model || ''
      // Chat Completions API
      if (evt.usage) {
        inputTokens = evt.usage.prompt_tokens || evt.usage.input_tokens || 0
        outputTokens = evt.usage.completion_tokens || evt.usage.output_tokens || 0
      }
      // Responses API — usage is on the completed response object
      if (evt.type === 'response.completed' && evt.response?.usage) {
        model = evt.response.model || model
        inputTokens = evt.response.usage.input_tokens || 0
        outputTokens = evt.response.usage.output_tokens || 0
      }
    } catch (_) { /* skip */ }
  }

  // Non-streaming response
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString())
      model = parsed.model || ''
      inputTokens = parsed.usage?.prompt_tokens || parsed.usage?.input_tokens || 0
      outputTokens = parsed.usage?.completion_tokens || parsed.usage?.output_tokens || 0
    } catch (_) { /* streaming, already handled */ }
  }

  return { inputTokens, outputTokens, model }
}

function logAndEmit({ provider, model, inputTokens, outputTokens, sessionId }) {
  if (!inputTokens && !outputTokens) return
  try {
    const { energyKwh, co2Grams, comparisons } = calculateEmissions(model, inputTokens, outputTokens)
    insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, sessionId })
    if (emitToRenderer) {
      emitToRenderer({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, comparisons, timestamp: Date.now() })
    }
  } catch (err) {
    console.error('[tokentrace] logAndEmit error:', err)
  }
}

function createProxyServer() {
  const server = http.createServer((req, res) => {
    const provider = detectProvider(req)
    const upstreamHost = provider === 'anthropic' ? ANTHROPIC_HOST : OPENAI_HOST
    const sessionId = req.headers['x-session-id'] || null
    console.log(`[proxy] ${req.method} ${req.url} → ${upstreamHost} (provider: ${provider})`)

    // Short-circuit GET /responses — Codex polls this to check for resumable sessions.
    // It always fails through a proxy (no WebSocket support), causing the reconnect loop.
    // Return empty list immediately so Codex skips session-resume and goes straight to POST.
    if (req.method === 'GET' && req.url.startsWith('/responses')) {
      const empty = JSON.stringify({ object: 'list', data: [], has_more: false })
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': empty.length })
      res.end(empty)
      return
    }

    // Collect request body
    const reqChunks = []
    req.on('data', (chunk) => reqChunks.push(chunk))
    req.on('end', () => {
      let bodyBuf = Buffer.concat(reqChunks)

      // For Chat Completions streaming only: inject stream_options to get usage in final chunk
      // (Responses API includes usage natively in response.completed — don't inject there)
      if (provider === 'openai' && (req.url.includes('/chat/completions'))) {
        try {
          const parsed = JSON.parse(bodyBuf.toString())
          if (parsed.stream) {
            parsed.stream_options = { include_usage: true }
            bodyBuf = Buffer.from(JSON.stringify(parsed))
          }
        } catch (_) { /* not JSON */ }
      }

      // Build upstream headers
      const upstreamHeaders = { ...req.headers }
      upstreamHeaders['host'] = upstreamHost
      delete upstreamHeaders['x-provider']
      delete upstreamHeaders['x-session-id']
      // Force uncompressed response so we can parse the SSE text
      delete upstreamHeaders['accept-encoding']
      // Don't set Content-Length on GET/HEAD — some servers reject it
      if (req.method === 'GET' || req.method === 'HEAD') {
        delete upstreamHeaders['content-length']
        delete upstreamHeaders['content-type']
      } else {
        upstreamHeaders['content-length'] = bodyBuf.length
      }

      // Ensure /v1 prefix — SDK may omit it when base URL already contains /v1
      const upstreamPath = req.url.startsWith('/v1') ? req.url : '/v1' + req.url

      const options = {
        hostname: upstreamHost,
        port: 443,
        path: upstreamPath,
        method: req.method,
        headers: upstreamHeaders,
        agent: provider === 'anthropic' ? anthropicAgent : openaiAgent
      }

      // For POST streaming (SSE) requests: send headers + keepalive comments immediately
      // so Codex doesn't time out while waiting for upstream to start responding.
      // SSE responses are always 200 text/event-stream, so this is safe.
      let keepaliveTimer = null
      const isStreaming = req.method === 'POST' &&
        (req.url.includes('responses') || req.url.includes('messages'))
      if (isStreaming) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive'
        })
        keepaliveTimer = setInterval(() => {
          if (!res.writableEnded) res.write(': keepalive\n\n')
        }, 5000)
      }

      const upstreamReq = https.request(options, (upstreamRes) => {
        // For non-streaming requests forward headers normally
        if (!isStreaming) res.writeHead(upstreamRes.statusCode, upstreamRes.headers)

        const resChunks = []
        upstreamRes.on('data', (chunk) => {
          res.write(chunk)
          resChunks.push(chunk)
        })

        upstreamRes.on('end', () => {
          if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null }
          res.end()
          const fullBuf = Buffer.concat(resChunks)
          const extract = provider === 'anthropic' ? extractAnthropicTokens : extractOpenAITokens
          const { inputTokens, outputTokens, model } = extract(fullBuf)
          logAndEmit({ provider, model, inputTokens, outputTokens, sessionId })
        })
      })

      upstreamReq.on('error', (err) => {
        console.error('[tokentrace] upstream error:', err.message)
        if (!res.headersSent) {
          res.writeHead(502)
          res.end(JSON.stringify({ error: 'TokenTrace proxy upstream error', detail: err.message }))
        }
      })

      upstreamReq.write(bodyBuf)
      upstreamReq.end()
    })
  })

  server.listen(PROXY_PORT, '127.0.0.1', () => {
    console.log(`[tokentrace] proxy listening on http://127.0.0.1:${PROXY_PORT}`)
  })

  return server
}

export { createProxyServer, setEmitter, PROXY_PORT }
