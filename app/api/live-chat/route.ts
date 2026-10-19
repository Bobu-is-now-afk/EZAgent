export const runtime = 'nodejs'
export const maxDuration = 60

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

function error(status: number, code: string) {
  return Response.json({ error: code }, { status, headers })
}

function validMessages(value: unknown): value is ChatTurn[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 8 &&
    value.at(-1)?.role === 'user' && value.every((turn) =>
      turn && typeof turn === 'object' && !Array.isArray(turn) &&
      (turn.role === 'user' || turn.role === 'assistant') &&
      typeof turn.content === 'string' && turn.content.trim().length > 0 &&
      turn.content.length <= 1200 && Object.keys(turn).every((key) => key === 'role' || key === 'content'))
}

export async function POST(request: Request) {
  const url = process.env.EZAGENT_CHAT_GATEWAY_URL
  const key = process.env.EZAGENT_CHAT_GATEWAY_KEY
  if (!url || !key) return error(503, 'live_chat_unavailable')
  let endpoint: URL
  try {
    endpoint = new URL(url)
    if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/chat' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error('Invalid endpoint')
  } catch { return error(503, 'live_chat_unavailable') }

  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return error(403, 'forbidden')
  if (Number(request.headers.get('content-length')) > 12_000) return error(413, 'request_too_large')
  let data: unknown
  try {
    const raw = await request.text()
    if (raw.length > 12_000) return error(413, 'request_too_large')
    data = JSON.parse(raw)
  } catch { return error(400, 'invalid_request') }
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((field) => field !== 'messages') || !validMessages((data as { messages?: unknown }).messages)) return error(400, 'invalid_request')

  try {
    const upstream = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(data), cache: 'no-store', signal: AbortSignal.timeout(50_000),
    })
    if (upstream.status === 429) return error(429, 'model_busy')
    if (!upstream.ok || Number(upstream.headers.get('content-length')) > 128_000) return error(503, 'live_chat_unavailable')
    const raw = await upstream.text()
    if (raw.length > 128_000) return error(503, 'live_chat_unavailable')
    const answer = (JSON.parse(raw) as { answer?: unknown }).answer
    if (typeof answer !== 'string' || !answer.trim()) return error(503, 'live_chat_unavailable')
    return Response.json({ answer: answer.trim().slice(0, 4_000), source: 'live', model: 'qwen3.5:9b' }, { headers })
  } catch { return error(503, 'live_chat_unavailable') }
}
