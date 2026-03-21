import http from 'http'
import https from 'https'
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
      // message_start has input tokens + model
      if (evt.type === 'message_start' && evt.message) {
        model = evt.message.model || ''
        inputTokens = evt.message.usage?.input_tokens || 0
      }
      // message_delta has output tokens
      if (evt.type === 'message_delta' && evt.usage) {
        outputTokens = evt.usage.output_tokens || 0
      }
      // Non-streaming response
      if (evt.usage && evt.model && !evt.type) {
        model = evt.model || ''
        inputTokens = evt.usage.input_tokens || 0
        outputTokens = evt.usage.output_tokens || 0
      }
    } catch (_) { /* not JSON, skip */ }
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
      model = model || evt.model || ''
      if (evt.usage) {
        inputTokens = evt.usage.prompt_tokens || 0
        outputTokens = evt.usage.completion_tokens || 0
      }
    } catch (_) { /* skip */ }
  }

  // Non-streaming response
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString())
      model = parsed.model || ''
      inputTokens = parsed.usage?.prompt_tokens || 0
      outputTokens = parsed.usage?.completion_tokens || 0
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

    // Collect request body
    const reqChunks = []
    req.on('data', (chunk) => reqChunks.push(chunk))
    req.on('end', () => {
      let bodyBuf = Buffer.concat(reqChunks)

      // For OpenAI streaming: inject stream_options to get usage in final chunk
      if (provider === 'openai') {
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
      upstreamHeaders['content-length'] = bodyBuf.length

      const options = {
        hostname: upstreamHost,
        port: 443,
        path: req.url,
        method: req.method,
        headers: upstreamHeaders
      }

      const upstreamReq = https.request(options, (upstreamRes) => {
        // Forward status + headers to client immediately
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers)

        // Buffer chunks for token extraction while piping to client
        const resChunks = []
        upstreamRes.on('data', (chunk) => {
          res.write(chunk)
          resChunks.push(chunk)
        })

        upstreamRes.on('end', () => {
          res.end()
          // Extract tokens after stream closes — never blocks the response
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
