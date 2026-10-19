import { GEMINI_MODEL } from '../lib/gemini.mjs'

export function GET() {
  const configured = Boolean(process.env.GEMINI_API_KEY)
  return Response.json({
    configured,
    connectivity: 'not_checked',
    ...(configured ? { source: 'gemini', model: GEMINI_MODEL } : {}),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
