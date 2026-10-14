import {
  DEMO_SESSION_COOKIE,
  cookieValue,
  demoConfig,
  demoDisabledResponse,
  validDemoOrigin,
  verifyDemoSession,
} from '../../../../lib/demo/access-control'
import { reservePublicProbe } from '../../../../lib/demo/limits'
import { demoPolicyUnavailableResponse, isDemoPolicyAvailable } from '../../../../lib/demo/policy-readiness'
import { createDemoSessionPostHandler } from '../../../../lib/demo/session-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  if (!reservePublicProbe()) return Response.json({ error: { code: 'demo_rate_limited', message: 'Too many session checks. Please wait before trying again.' } }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } })
  const config = demoConfig()
  if (!config) return demoDisabledResponse()
  if (!(await isDemoPolicyAvailable())) return demoPolicyUnavailableResponse()
  if (!validDemoOrigin(request, config)) return Response.json({ error: { code: 'invalid_origin', message: 'Request origin is not allowed.' } }, { status: 403 })
  const ownerId = verifyDemoSession(cookieValue(request.headers.get('cookie')), config)
  return Response.json({ authenticated: Boolean(ownerId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export const POST = createDemoSessionPostHandler()

export async function DELETE(request: Request): Promise<Response> {
  const config = demoConfig()
  if (!config) return demoDisabledResponse()
  if (!validDemoOrigin(request, config)) return Response.json({ error: { code: 'invalid_origin', message: 'Request origin is not allowed.' } }, { status: 403 })
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': `${DEMO_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure` },
  })
}
