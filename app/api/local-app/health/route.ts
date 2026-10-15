import { isLocalRequest } from '../../../../lib/local-ai/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  if (!isLocalRequest(request)) return Response.json({ state: 'local_only' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  const instance = process.env.EZAGENT_APP_HEALTH_TOKEN
  if (!instance) return Response.json({ state: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  return Response.json({ service: 'ezagent-local-app', instance }, { headers: { 'Cache-Control': 'no-store' } })
}
