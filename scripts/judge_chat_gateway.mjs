#!/usr/bin/env node
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const MODEL = 'qwen3.5:9b'
const SYSTEM = 'You are EZAgent in a university Hackathon product preview. Answer clearly and briefly. Do not claim to have opened files, run tools, sent messages, created documents, or verified facts outside this chat. When information is missing, say so.'
const MAX_BODY = 12_000
const MAX_RESPONSE = 128_000
const MAX_PER_MINUTE = 8
const TIMEOUT_MS = 45_000

function reply(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}

function sameKey(value, key) {
  if (typeof value !== 'string' || value.length > 512) return false
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(key).digest())
}

function validMessages(messages) {
  return Array.isArray(messages) && messages.length >= 1 && messages.length <= 8 &&
    messages.at(-1)?.role === 'user' && messages.every((item) =>
      item && typeof item === 'object' && !Array.isArray(item) &&
      ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' &&
      item.content.trim().length > 0 && item.content.length <= 1_200 &&
      Object.keys(item).every((key) => ['role', 'content'].includes(key)))
}

async function readLimited(stream, max) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > max) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function upstreamText(response) {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE) { await reader.cancel(); return null }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { reader.releaseLock() }
}

export function createJudgeChatGateway({ key, fetchImpl = fetch, now = Date.now, ollamaOrigin = 'http://127.0.0.1:11434' } = {}) {
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32 || Buffer.byteLength(key) > 256) throw new Error('EZAGENT_CHAT_GATEWAY_KEY must be 32–256 bytes')
  const url = new URL(ollamaOrigin)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Ollama must be a loopback HTTP origin')
  let active = false
  let windowStart = now()
  let accepted = 0

  const server = createServer(async (req, res) => {
    const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
    if (!sameKey(bearer, key)) return reply(res, 401, { error: 'unauthorized' })
    if (req.url === '/healthz' && req.method === 'GET') return reply(res, 200, { status: 'ok', model: MODEL })
    if (req.url !== '/chat' || req.method !== 'POST') return reply(res, 404, { error: 'not_found' })
    if (now() - windowStart >= 60_000) { windowStart = now(); accepted = 0 }
    if (active || accepted >= MAX_PER_MINUTE) return reply(res, 429, { error: 'busy' })
    if (Number(req.headers['content-length']) > MAX_BODY) return reply(res, 413, { error: 'too_large' })
    let body
    try {
      const text = await readLimited(req, MAX_BODY)
      if (text === null) return reply(res, 413, { error: 'too_large' })
      body = JSON.parse(text)
    } catch { return reply(res, 400, { error: 'invalid_json' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'messages') || !validMessages(body.messages)) return reply(res, 400, { error: 'invalid_request' })
    if (active || accepted >= MAX_PER_MINUTE) return reply(res, 429, { error: 'busy' })
    active = true
    accepted += 1
    try {
      const upstream = await fetchImpl(`${url.origin}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: SYSTEM }, ...body.messages], stream: false, think: false, options: { num_predict: 256, temperature: 0.5 }, keep_alive: '5m' }),
      })
      if (!upstream.ok || Number(upstream.headers.get('content-length')) > MAX_RESPONSE) return reply(res, 502, { error: 'model_unavailable' })
      const raw = await upstreamText(upstream)
      if (!raw) return reply(res, 502, { error: 'model_unavailable' })
      const answer = JSON.parse(raw)?.message?.content
      if (typeof answer !== 'string' || !answer.trim()) return reply(res, 502, { error: 'model_unavailable' })
      return reply(res, 200, { answer: answer.trim().slice(0, 4_000), model: MODEL })
    } catch { return reply(res, 503, { error: 'model_unavailable' }) }
    finally { active = false }
  })
  server.headersTimeout = 5_000
  server.requestTimeout = 10_000
  return server
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const port = Number(process.env.EZAGENT_CHAT_GATEWAY_PORT || 8765)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid gateway port')
  const server = createJudgeChatGateway({ key: process.env.EZAGENT_CHAT_GATEWAY_KEY })
  server.listen(port, '127.0.0.1', () => process.stdout.write(`[OK] judge chat gateway listening on 127.0.0.1:${port}\n`))
}
