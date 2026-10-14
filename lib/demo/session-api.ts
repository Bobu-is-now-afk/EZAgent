import {
  DEMO_SESSION_COOKIE,
  demoConfig,
  demoDisabledResponse,
  isCorrectAccessCode,
  issueDemoSession,
  validDemoOrigin,
} from './access-control'
import { reserveLoginAttempt } from './limits'
import { demoPolicyUnavailableResponse, isDemoPolicyAvailable } from './policy-readiness'

async function readCode(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 512) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    const body = JSON.parse(text) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('code' in body)) return null
    return (body as { code: unknown }).code
  } catch {
    return null
  }
}

export function createDemoSessionPostHandler(policyReady: () => Promise<boolean> = isDemoPolicyAvailable) {
  return async function handleSessionPost(request: Request): Promise<Response> {
    const config = demoConfig()
    if (!config) return demoDisabledResponse()
    if (!validDemoOrigin(request, config)) return Response.json({ error: { code: 'invalid_origin', message: 'Request origin is not allowed.' } }, { status: 403 })
    if (!(await policyReady().catch(() => false))) return demoPolicyUnavailableResponse()
    if (!(await reserveLoginAttempt())) return Response.json({ error: { code: 'demo_rate_limited', message: 'Too many access attempts. Please wait before trying again.' } }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } })

    const code = await readCode(request)
    if (!isCorrectAccessCode(code, config)) {
      return Response.json({ error: { code: 'invalid_demo_access', message: 'The demo access code is invalid.' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    const session = issueDemoSession(config)
    return Response.json({ authenticated: true, expiresAt: new Date(session.expiresAt * 1000).toISOString() }, {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `${DEMO_SESSION_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=14400; Secure`,
      },
    })
  }
}
