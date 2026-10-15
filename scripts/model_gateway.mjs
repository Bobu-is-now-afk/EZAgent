#!/usr/bin/env node
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const MODEL = 'qwen3.5:9b'
const MAX_BODY_BYTES = 32 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_REQUESTS_PER_MINUTE = 12
const MODEL_TIMEOUT_MS = 45_000

function json(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  response.end(JSON.stringify(payload))
}

function equalSecret(candidate, expected) {
  if (typeof candidate !== 'string' || candidate.length > 512) return false
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20) return false
  return messages.every((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) return false
    const hasText = typeof message.content === 'string' && message.content.length <= 8_000
    const hasToolCalls = message.role === 'assistant' && message.content === null &&
      Array.isArray(message.tool_calls) && message.tool_calls.length <= 8
    if (!hasText && !hasToolCalls) return false
    if (message.role === 'tool' && (typeof message.tool_call_id !== 'string' || message.tool_call_id.length > 128)) return false
    return true
  })
}

function validRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  if (body.model !== undefined && body.model !== MODEL) return false
  if (body.stream !== undefined && body.stream !== false) return false
  if (!validMessages(body.messages)) return false
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 8)) return false
  if (body.temperature !== undefined &&
      (!Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) return false
  for (const field of ['max_tokens', 'max_completion_tokens']) {
    if (body[field] !== undefined && (!Number.isInteger(body[field]) || body[field] < 1 || body[field] > 1024)) return false
  }
  return true
}

async function readLimited(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readUpstreamLimited(response) {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    reader.releaseLock()
  }
}

function loopbackOllamaUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('MODEL_GATEWAY_OLLAMA_URL must be a loopback HTTP origin')
  }
  return url.origin
}

export function createGateway({ apiKey, ollamaUrl = 'http://127.0.0.1:11434', fetchImpl = fetch,
  now = Date.now } = {}) {
  if (typeof apiKey !== 'string' || Buffer.byteLength(apiKey) < 32 || Buffer.byteLength(apiKey) > 256) {
    throw new Error('MODEL_GATEWAY_API_KEY must be a 32–256 byte secret from the runtime environment')
  }
  const ollamaOrigin = loopbackOllamaUrl(ollamaUrl)
  let active = false
  let windowStart = now()
  let count = 0

  const server = createServer(async (request, response) => {
    const authorization = request.headers.authorization
    const suppliedKey = typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice(7) : ''
    if (!equalSecret(suppliedKey, apiKey)) {
      json(response, 401, { error: { code: 'unauthorized' } })
      return
    }
    if (request.url === '/healthz' && request.method === 'GET') {
      json(response, 200, { status: 'ok' })
      return
    }
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      json(response, 404, { error: { code: 'not_found' } })
      return
    }
    if (now() - windowStart >= 60_000) {
      windowStart = now()
      count = 0
    }
    if (count >= MAX_REQUESTS_PER_MINUTE || active) {
      json(response, 429, { error: { code: 'model_busy' } }, { 'retry-after': '5' })
      return
    }
    if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
      json(response, 413, { error: { code: 'request_too_large' } })
      return
    }
    let body
    try {
      const raw = await readLimited(request)
      if (raw === null) {
        json(response, 413, { error: { code: 'request_too_large' } })
        return
      }
      body = JSON.parse(raw)
    } catch {
      json(response, 400, { error: { code: 'invalid_json' } })
      return
    }
    if (!validRequest(body)) {
      json(response, 400, { error: { code: 'invalid_request' } })
      return
    }

    // Recheck after the asynchronous body read so simultaneous requests cannot pass together.
    if (count >= MAX_REQUESTS_PER_MINUTE || active) {
      json(response, 429, { error: { code: 'model_busy' } }, { 'retry-after': '5' })
      return
    }

    active = true
    count += 1
    try {
      const upstream = await fetchImpl(`${ollamaOrigin}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: body.messages,
          stream: false,
          max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 512,
          ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
          ...(body.tools === undefined ? {} : { tools: body.tools }),
          ...(body.tool_choice === undefined ? {} : { tool_choice: body.tool_choice }),
          ...(body.response_format === undefined ? {} : { response_format: body.response_format }),
        }),
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      })
      if (!upstream.ok) {
        json(response, upstream.status === 404 ? 503 : 502, { error: { code: 'model_unavailable' } })
        return
      }
      const contentLength = Number(upstream.headers.get('content-length'))
      if (contentLength > MAX_RESPONSE_BYTES) {
        json(response, 502, { error: { code: 'model_response_too_large' } })
        return
      }
      const raw = await readUpstreamLimited(upstream)
      if (raw === null) {
        json(response, 502, { error: { code: 'model_response_too_large' } })
        return
      }
      const result = JSON.parse(raw)
      json(response, 200, result)
    } catch {
      json(response, 502, { error: { code: 'model_unreachable' } })
    } finally {
      active = false
    }
  })
  server.headersTimeout = 5_000
  server.requestTimeout = 10_000
  return server
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const port = Number(process.env.MODEL_GATEWAY_PORT ?? 8765)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('MODEL_GATEWAY_PORT must be an integer from 1024 to 65535')
  }
  const server = createGateway({
    apiKey: process.env.MODEL_GATEWAY_API_KEY,
    ollamaUrl: process.env.MODEL_GATEWAY_OLLAMA_URL,
  })
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`model gateway listening on 127.0.0.1:${port}\n`)
  })
}
