import { NextResponse, type NextRequest } from 'next/server'

import {
  DEMO_OWNER_HEADER,
  demoConfig,
  demoDisabledResponse,
  cookieValue,
  unauthorizedDemoResponse,
  validDemoOrigin,
  verifyDemoSession,
} from './lib/demo/access-control'

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next()

  const isCapabilities = request.nextUrl.pathname === '/api/demo/capabilities'
  if (isCapabilities) return NextResponse.next()

  const config = demoConfig()
  if (!config) return demoDisabledResponse()
  if (request.nextUrl.pathname === '/api/local-ai' || request.nextUrl.pathname.startsWith('/api/local-ai/')) {
    return Response.json({ error: { code: 'demo_route_disabled', message: 'Local model preparation is disabled on the hosted demo.' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  if (request.nextUrl.pathname === '/api/chat' || request.nextUrl.pathname.startsWith('/api/chat/')) {
    return Response.json({ error: { code: 'demo_route_disabled', message: 'Hosted chat is not part of the invoice demo.' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  if (request.nextUrl.pathname === '/api/agent/plans') {
    return Response.json({ error: { code: 'demo_route_disabled', message: 'Hosted invoice planning must use the bounded demo job queue.' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  if (process.env.EZAGENT_DEMO_MAINTENANCE === '1' && request.nextUrl.pathname !== '/api/demo/capabilities') {
    return Response.json({ error: { code: 'demo_maintenance', message: 'The hosted demo is temporarily unavailable.' } }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } })
  }

  if (!validDemoOrigin(request, config)) {
    return Response.json({ error: { code: 'invalid_origin', message: 'Request origin is not allowed.' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 1_048_576) {
    return Response.json({ error: { code: 'request_too_large', message: 'Request exceeds the 1 MiB limit.' } }, { status: 413, headers: { 'Cache-Control': 'no-store' } })
  }

  const isSessionRoute = request.nextUrl.pathname === '/api/demo/session'
  const sessionOwner = verifyDemoSession(cookieValue(request.headers.get('cookie')), config)
  if (!isSessionRoute && !sessionOwner) return unauthorizedDemoResponse()

  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.delete(DEMO_OWNER_HEADER)
  if (sessionOwner) forwardedHeaders.set(DEMO_OWNER_HEADER, sessionOwner)
  else forwardedHeaders.delete(DEMO_OWNER_HEADER)
  return NextResponse.next({ request: { headers: forwardedHeaders } })
}

export const config = { matcher: ['/api/:path*'] }
