import { DemoError, LIMITS } from './gemini.mjs'

const MINUTE = 60_000
const DAY = 24 * 60 * 60_000
const shared = globalThis

export function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function fail(error) {
  if (error instanceof DemoError) return json({ status: 'error', error: error.code }, error.status)
  return json({ status: 'error', error: 'provider_unavailable' }, 500)
}

export async function readJson(request) {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > LIMITS.bodyBytes) throw new DemoError('request_too_large', 413)
  if (!request.body) throw new DemoError('invalid_input', 400)
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > LIMITS.bodyBytes) {
        await reader.cancel()
        throw new DemoError('request_too_large', 413)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { throw new DemoError('invalid_input', 400) }
}

// This is a per-warm-instance abuse brake, not a public spend cap on serverless.
export function rateLimit(now = Date.now()) {
  let state = shared.demoGeminiRateLimit
  if (!state || now - state.dayAt >= DAY) {
    state = { minuteAt: now, minuteCount: 0, dayAt: now, dayCount: 0 }
    shared.demoGeminiRateLimit = state
  } else if (now - state.minuteAt >= MINUTE) {
    state.minuteAt = now
    state.minuteCount = 0
  }
  if (state.dayCount >= 50 || state.minuteCount >= 8) return json({ status: 'error', error: 'rate_limited' }, 429)
  state.dayCount += 1
  state.minuteCount += 1
}

export function methodNotAllowed() { return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } }) }
