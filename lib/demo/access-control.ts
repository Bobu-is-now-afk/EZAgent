import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const DEMO_SESSION_COOKIE = 'ezagent_demo_session'
export const DEMO_OWNER_HEADER = 'x-ezagent-demo-owner'
export const DEMO_SESSION_TTL_SECONDS = 4 * 60 * 60

export type DemoConfig = {
  origin: string
  accessCode: string
  sessionSecret: string
  dataPolicyUrl: string
}

export function demoConfig(env: NodeJS.ProcessEnv = process.env): DemoConfig | null {
  if (env.NODE_ENV !== 'production' || env.EZAGENT_DEMO_ENABLED !== '1' || env.EZAGENT_DEMO_RELEASE_APPROVED !== '1') return null
  const origin = env.EZAGENT_DEMO_ORIGIN
  const accessCode = env.EZAGENT_DEMO_ACCESS_CODE
  const sessionSecret = env.EZAGENT_SESSION_SECRET
  const dataPolicyUrl = env.EZAGENT_DEMO_DATA_POLICY_URL
  if (!origin || !accessCode || !sessionSecret || !dataPolicyUrl || accessCode.length < 20 || sessionSecret.length < 32 ||
      !/^\/[\x21-\x7e]+$/.test(dataPolicyUrl) || dataPolicyUrl.startsWith('//') || /[?#\\]/.test(dataPolicyUrl) || dataPolicyUrl.split('/').some((part) => part === '.' || part === '..')) return null
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
  } catch {
    return null
  }
  return { origin, accessCode, sessionSecret, dataPolicyUrl }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issueDemoSession(config: DemoConfig, now = Date.now()): { ownerId: string; token: string; expiresAt: number } {
  const ownerId = randomUUID()
  const expiresAt = Math.floor(now / 1000) + DEMO_SESSION_TTL_SECONDS
  const payload = Buffer.from(JSON.stringify({ ownerId, expiresAt })).toString('base64url')
  return { ownerId, token: `${payload}.${sign(payload, config.sessionSecret)}`, expiresAt }
}

export function verifyDemoSession(token: string | undefined, config: DemoConfig, now = Date.now()): string | null {
  if (!token || token.length > 512) return null
  const [payload, suppliedSignature, extra] = token.split('.')
  if (!payload || !suppliedSignature || extra !== undefined) return null
  const expectedSignature = sign(payload, config.sessionSecret)
  const supplied = Buffer.from(suppliedSignature)
  const expected = Buffer.from(expectedSignature)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { ownerId?: unknown; expiresAt?: unknown }
    if (typeof value.ownerId !== 'string' || !/^[0-9a-f-]{36}$/.test(value.ownerId) ||
        typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= Math.floor(now / 1000) || value.expiresAt > Math.floor(now / 1000) + DEMO_SESSION_TTL_SECONDS) return null
    return value.ownerId
  } catch {
    return null
  }
}

export function cookieValue(cookieHeader: string | null, name = DEMO_SESSION_COOKIE): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator >= 0 && trimmed.slice(0, separator) === name) return trimmed.slice(separator + 1)
  }
  return undefined
}

export function validDemoOrigin(request: Request, config: DemoConfig): boolean {
  const origin = request.headers.get('origin')
  if (origin) return origin === config.origin
  const method = request.method.toUpperCase()
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

export function isCorrectAccessCode(candidate: unknown, config: DemoConfig): boolean {
  if (typeof candidate !== 'string' || candidate.length > 256) return false
  const expected = createHmac('sha256', config.sessionSecret).update(config.accessCode).digest()
  const supplied = createHmac('sha256', config.sessionSecret).update(candidate).digest()
  return timingSafeEqual(expected, supplied)
}

export function requestOwnerId(request: Request): string | null {
  if (process.env.NODE_ENV !== 'production') return 'local'
  const ownerId = request.headers.get(DEMO_OWNER_HEADER)
  return ownerId && /^[0-9a-f-]{36}$/.test(ownerId) ? ownerId : null
}

export function demoDisabledResponse(): Response {
  return Response.json({ error: { code: 'demo_unavailable', message: 'The online demo is disabled or not configured.' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
}

export function unauthorizedDemoResponse(): Response {
  return Response.json({ error: { code: 'demo_auth_required', message: 'Enter the demo access code to continue.' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
}
