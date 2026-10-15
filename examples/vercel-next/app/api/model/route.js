/** Copy this file into the teammate's Next.js project's app/api/model/ directory. */
import { callModel } from '../../../lib/model-client'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'invalid_origin' }, { status: 403 })
  }
  if (Number(request.headers.get('content-length')) > 4_096) {
    return Response.json({ error: 'request_too_large' }, { status: 413 })
  }
  let input
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 4_096) {
      return Response.json({ error: 'request_too_large' }, { status: 413 })
    }
    input = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof input?.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2_000) {
    return Response.json({ error: 'invalid_prompt' }, { status: 400 })
  }
  try {
    const result = await callModel({ messages: [{ role: 'user', content: input.prompt }] })
    return Response.json({ answer: result.choices?.[0]?.message?.content ?? '' },
      { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: error.status === 429 ? 'model_busy' : 'model_unavailable' },
      { status: error.status === 429 ? 429 : 503, headers: { 'cache-control': 'no-store' } })
  }
}
