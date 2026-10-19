// Copy as app/api/judge-demo/route.js. Server runtime only.
export const runtime = 'nodejs'
export const maxDuration = 60

function reply(status, payload) {
  return Response.json(payload, { status, headers: {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    ...(status === 429 ? { 'retry-after': '5' } : {}),
  } })
}

async function boundedJson(stream, limit) {
  if (!stream) throw new Error('missing_body')
  const reader = stream.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) { await reader.cancel(); throw new Error('too_large') }
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { reader.releaseLock() }
}

export async function POST(request) {
  // This flag is an operator release gate, NOT authentication.
  // Verified Vercel Deployment Protection must cover this route before enabling.
  if (process.env.VERCEL_ENV !== 'preview' || process.env.JUDGE_DEMO_ENABLED !== 'true')
    return reply(503, { error: 'demo_disabled' })
  let url
  const key = process.env.JUDGE_GATEWAY_API_KEY
  try {
    url = new URL(process.env.JUDGE_GATEWAY_URL)
    if (url.protocol !== 'https:' || url.username || url.password || url.search ||
        url.hash || url.pathname !== '/v1/synthetic' || !key || key.length < 32)
      throw new Error('configuration')
  } catch { return reply(503, { error: 'demo_unavailable' }) }

  let body
  try {
    body = await boundedJson(request.body, 128)
    if (!body || Object.keys(body).length !== 1 ||
        !['design', 'print', 'consultation'].includes(body.scenario)) throw new Error('invalid')
  } catch { return reply(400, { error: 'invalid_scenario' }) }

  try {
    const upstream = await fetch(url, {
      method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(50_000),
    })
    if (!upstream.ok) {
      await upstream.body?.cancel()
      return reply(upstream.status === 429 ? 429 : 503,
        { error: upstream.status === 429 ? 'demo_busy' : 'demo_unavailable' })
    }
    const data = await boundedJson(upstream.body, 1024)
    const amounts = { design: 800, print: 120, consultation: 500 }
    if (data.demoOnly !== true || data.status !== 'draft_only' || data.source !== 'live_model' ||
        data.scenario !== body.scenario || data.item !== body.scenario ||
        data.currency !== 'HKD' || data.amount !== amounts[body.scenario]) throw new Error('invalid')
    return reply(200, { demoOnly: true, status: 'draft_only', source: 'live_model',
      scenario: body.scenario, item: body.scenario, currency: 'HKD', amount: data.amount })
  } catch { return reply(503, { error: 'demo_unavailable' }) }
}
