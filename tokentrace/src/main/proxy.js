import http from 'http'
import https from 'https'

const anthropicAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
const openaiAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
const geminiAgent = new https.Agent({ keepAlive: true, maxSockets: 10 })
import { insertEvent } from './db'
import { calculateEmissions } from './emissions'

const ANTHROPIC_HOST = 'api.anthropic.com'
const OPENAI_HOST = 'api.openai.com'
const GEMINI_HOST = 'generativelanguage.googleapis.com'
const PROXY_PORT = 3001

let emitToRenderer = null // set by main.js after window is created
let compressionEnabled = false
const COMPRESS_THRESHOLD = 600   // chars ≈ 150 tokens — below this, skip
const COMPRESS_CEILING   = 3000  // chars ≈ 750 tokens — above this, likely file content/tool output, skip

const COMPRESS_SYSTEM = `You are a prompt compressor. Rewrite the user message to be as concise as possible.
Rules:
1. NEVER modify technical content: code, commands, error messages, numbers, filenames, library names, URLs, version numbers, configs, stack traces, variable names, data structures
2. REMOVE human conversational elements: greetings, hedging phrases ("I think", "maybe", "kind of"), narrative structure, politeness, repetition, and filler words
3. KEEP all technical requirements, constraints, questions, and context
4. Output ONLY the rewritten message — no preamble, no explanation`

function setEmitter(fn) {
  emitToRenderer = fn
}

function setCompressionEnabled(val) {
  compressionEnabled = val
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body)
    const req = https.request({ hostname, port: 443, path, method: 'POST', headers: { ...headers, 'content-length': buf.length }, agent: hostname.includes('anthropic') ? anthropicAgent : openaiAgent }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')) })
    req.write(buf)
    req.end()
  })
}

async function compressUserMessage(content, provider, apiKey) {
  console.log(`[compress] sending to ${provider}, keyLen=${apiKey?.length ?? 0}, contentLen=${content.length}`)
  try {
    if (provider === 'anthropic') {
      const { status, data } = await httpsPost(
        'api.anthropic.com', '/v1/messages',
        { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: COMPRESS_SYSTEM, messages: [{ role: 'user', content }] })
      )
      console.log(`[compress] anthropic response: status=${status} resultLen=${data.content?.[0]?.text?.length ?? 'n/a'}`)
      if (data.error) console.error('[compress] anthropic api error:', JSON.stringify(data.error))
      return data.content?.[0]?.text || content
    } else if (provider === 'openai') {
      const { status, data } = await httpsPost(
        'api.openai.com', '/v1/chat/completions',
        { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
        JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: COMPRESS_SYSTEM }, { role: 'user', content }] })
      )
      console.log(`[compress] openai response: status=${status} resultLen=${data.choices?.[0]?.message?.content?.length ?? 'n/a'}`)
      if (data.error) console.error('[compress] openai api error:', JSON.stringify(data.error))
      return data.choices?.[0]?.message?.content || content
    }
  } catch (err) {
    console.error('[compress] fetch error:', err.message)
  }
  return content
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
  if (req.url.includes('generateContent') || req.url.includes('streamGenerateContent') ||
    req.url.startsWith('/v1beta/') || req.url.startsWith('/v1/models/')) return 'gemini'

  // 3. API key prefix
  const auth = req.headers['authorization'] || ''
  const key = auth.replace(/^Bearer\s+/i, '')
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('sk-')) return 'openai'
  const googleKey = req.headers['x-goog-api-key'] || ''
  if (googleKey.startsWith('AIza')) return 'gemini'

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

function extractGeminiTokens(buffer, reqUrl) {
  let inputTokens = 0
  let outputTokens = 0
  // Extract model from URL: /v1beta/models/gemini-2.5-flash:streamGenerateContent
  let model = ''
  const modelMatch = (reqUrl || '').match(/\/models\/([^/:?]+)/)
  if (modelMatch) model = modelMatch[1]

  // Gemini SSE: each data line is a JSON GenerateContentResponse
  const lines = buffer.toString().split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const raw = line.slice(6).trim()
    if (!raw || raw === '[DONE]') continue
    try {
      const evt = JSON.parse(raw)
      if (evt.usageMetadata) {
        inputTokens = evt.usageMetadata.promptTokenCount || inputTokens
        outputTokens = evt.usageMetadata.candidatesTokenCount || outputTokens
        model = evt.modelVersion || model
      }
    } catch (_) { /* skip */ }
  }

  // Non-streaming: single JSON response body
  if (!inputTokens) {
    try {
      const parsed = JSON.parse(buffer.toString())
      if (parsed.usageMetadata) {
        inputTokens = parsed.usageMetadata.promptTokenCount || 0
        outputTokens = parsed.usageMetadata.candidatesTokenCount || 0
        model = parsed.modelVersion || model
      }
    } catch (_) { /* streaming, already handled */ }
  }

  return { inputTokens, outputTokens, model }
}

function logAndEmit({ provider, model, inputTokens, outputTokens, sessionId, compressionStats }) {
  if (!inputTokens && !outputTokens) return
  try {
    const { energyKwh, co2Grams, comparisons } = calculateEmissions(model, inputTokens, outputTokens)
    insertEvent({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, sessionId, compressionStats })
    if (emitToRenderer) {
      emitToRenderer({ provider, model, inputTokens, outputTokens, energyKwh, co2Grams, comparisons, compressionStats, timestamp: Date.now() })
    }
  } catch (err) {
    console.error('[tokentrace] logAndEmit error:', err)
  }
}

function createProxyServer() {
  const server = http.createServer((req, res) => {
    const provider = detectProvider(req)
    const upstreamHost = provider === 'anthropic' ? ANTHROPIC_HOST
      : provider === 'gemini' ? GEMINI_HOST
        : OPENAI_HOST
    const sessionId = req.headers['x-session-id'] || null
    const isInternalCall = req.headers['x-tokentrace-skip'] === '1'
    console.log(`[proxy] ${req.method} ${req.url} → ${upstreamHost} (provider: ${provider}) | ua=${req.headers['user-agent']?.slice(0,60)} origin=${req.socket?.remoteAddress}:${req.socket?.remotePort}`)

    // Control endpoint — lets external scripts toggle compression without IPC
    if (req.url === '/tokentrace/compression') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const { enabled } = JSON.parse(Buffer.concat(chunks).toString())
          compressionEnabled = !!enabled
          const body = JSON.stringify({ ok: true, compression: compressionEnabled })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(body)
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ error: 'bad request' }))
        }
      })
      return
    }

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
    req.on('end', async () => {
      let bodyBuf = Buffer.concat(reqChunks)
      let compressionStats = null

      // Skip compression and logging for our own internal Haiku/GPT-4o-mini calls
      if (isInternalCall) {
        // Forward directly — no compression, no logging
        const upstreamHeaders = { ...req.headers }
        upstreamHeaders['host'] = upstreamHost
        delete upstreamHeaders['x-tokentrace-skip']
        delete upstreamHeaders['accept-encoding']
        upstreamHeaders['content-length'] = bodyBuf.length
        const upstreamPath = (provider === 'gemini' || req.url.startsWith('/v1')) ? req.url : '/v1' + req.url
        const upstreamReq = https.request({ hostname: upstreamHost, port: 443, path: upstreamPath, method: req.method, headers: upstreamHeaders, agent: provider === 'anthropic' ? anthropicAgent : openaiAgent }, (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode, upstreamRes.headers)
          upstreamRes.pipe(res)
        })
        upstreamReq.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end() } })
        upstreamReq.write(bodyBuf)
        upstreamReq.end()
        return
      }

      // Compress long user messages if enabled (skips Gemini — different message schema)
      if (compressionEnabled && provider !== 'gemini' && req.method === 'POST') {
        try {
          const parsed = JSON.parse(bodyBuf.toString())
          console.log(`[proxy] request model=${parsed.model} port=${req.socket?.remotePort}`)

          const messages = parsed.messages || []
          const lastUser = [...messages].reverse().find(m => m.role === 'user')

          // Extract plain text from either a string or a content-block array.
          // Claude Code injects context (system-reminder, file refs, etc.) into EARLIER text
          // blocks — the user's actual typed message is always the LAST text block.
          let original = null
          let isArray = false
          let targetBlock = null
          if (lastUser) {
            if (typeof lastUser.content === 'string') {
              original = lastUser.content
            } else if (Array.isArray(lastUser.content)) {
              const textBlocks = lastUser.content.filter(b => b.type === 'text' && b.text)
              if (textBlocks.length > 0) {
                targetBlock = textBlocks[textBlocks.length - 1] // last block = user's actual message
                original = targetBlock.text
                isArray = true
              }
            }
          }

          // Skip if the message contains injected XML context blocks (system-reminder, ide_opened_file, etc.)
          // These are Claude Code harness injections, not user-authored text
          const hasInjectedContext = original && /<(system-reminder|ide_opened_file|ide_selection)\b/.test(original)

          if (original && original.length > COMPRESS_THRESHOLD && original.length <= COMPRESS_CEILING && !hasInjectedContext) {
            const apiKey = provider === 'anthropic'
              ? (req.headers['x-api-key'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''))
              : (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
            const compressed = await compressUserMessage(original, provider, apiKey)
            if (compressed && compressed !== original && compressed.length < original.length) {
              // Write back — only touch the last text block (the user's actual message)
              if (isArray && targetBlock) {
                targetBlock.text = compressed
              } else {
                lastUser.content = compressed
              }
              bodyBuf = Buffer.from(JSON.stringify(parsed))
              compressionStats = { originalChars: original.length, compressedChars: compressed.length, originalText: original, compressedText: compressed }
              const origTokens = Math.ceil(original.length / 4)
              const compTokens = Math.ceil(compressed.length / 4)
              console.log([
                '─'.repeat(60),
                `[compress] ${provider} · −${origTokens - compTokens} tokens (${Math.round((1 - compressed.length / original.length) * 100)}% reduction)`,
                `  ORIGINAL  (~${origTokens} tok): ${original}`,
                `  COMPRESSED (~${compTokens} tok): ${compressed}`,
                '─'.repeat(60),
              ].join('\n'))
            }
          }
        } catch (err) {
          console.error('[compress] parse error:', err.message)
        }
      }

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

      // Ensure /v1 prefix for Anthropic/OpenAI — SDK may omit it when base URL contains /v1.
      // Gemini paths already include /v1beta/ so skip the prefix addition.
      const upstreamPath = (provider === 'gemini' || req.url.startsWith('/v1'))
        ? req.url
        : '/v1' + req.url

      const options = {
        hostname: upstreamHost,
        port: 443,
        path: upstreamPath,
        method: req.method,
        headers: upstreamHeaders,
        agent: provider === 'anthropic' ? anthropicAgent
          : provider === 'gemini' ? geminiAgent
            : openaiAgent
      }

      let keepaliveTimer = null
      let bodyStream = false
      try { bodyStream = !!JSON.parse(bodyBuf.toString()).stream } catch (_) {}
      const isStreaming = req.method === 'POST' && (
        req.url.includes('streamGenerateContent') || // Gemini always streams by URL
        bodyStream // Anthropic/OpenAI: only if client explicitly set stream:true
      )
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
          const extract = provider === 'anthropic' ? extractAnthropicTokens
            : provider === 'gemini' ? (buf) => extractGeminiTokens(buf, req.url)
              : extractOpenAITokens
          const { inputTokens, outputTokens, model } = extract(fullBuf)
          logAndEmit({ provider, model, inputTokens, outputTokens, sessionId, compressionStats })
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

export { createProxyServer, setEmitter, setCompressionEnabled, PROXY_PORT }
