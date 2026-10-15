import { createHmac, timingSafeEqual } from 'node:crypto'
import type { HostedDocumentConfig } from './hosted-config'
import { inviteTokenMatches, hostedRequestOriginAllowed, readHostedDocumentConfig } from './hosted-config'
import { authorizeOwnerSessionAndRecordRequest, recordHostedRequest, issueOwnerSession, revokeOwnerSession, validateOwnerSession, type HostedControlError } from './hosted-control'
import { readDocumentRuntimeMode } from './runtime-mode'
import { isRecord } from './validation'

export const DOCUMENT_SESSION_COOKIE = 'ezagent_docs_session'
export const MAX_DOCUMENT_URL_BYTES = 2 * 1024
const MAX_SESSION_REQUEST_BYTES = 8 * 1024

export type HostedSessionClaims = { ownerId: string; nonce: string; expiresAt: number }
export type HostedSessionLogin = { inviteId: string; accessToken: string; policyVersion: string; policyAccepted: true }
export type HostedRequestResolution =
  | { mode: 'disabled' }
  | { mode: 'unavailable'; response: Response }
  | { mode: 'authenticated'; config: HostedDocumentConfig; session: HostedSessionClaims }

function encodeClaims(claims: HostedSessionClaims): string {
  return Buffer.from(JSON.stringify({ v: 1, ...claims }), 'utf8').toString('base64url')
}

export function signHostedSession(claims: HostedSessionClaims, secret: string): string {
  const payload = encodeClaims(claims)
  const signature = createHmac('sha256', secret).update(payload, 'ascii').digest('base64url')
  return `${payload}.${signature}`
}

export function verifyHostedSessionToken(token: string, secret: string, now = Date.now()): HostedSessionClaims | null {
  if (token.length > 2_048) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null
  const expected = createHmac('sha256', secret).update(parts[0], 'ascii').digest()
  const actual = Buffer.from(parts[1], 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  let value: unknown
  try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch { return null }
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'expiresAt,nonce,ownerId,v' || value.v !== 1 ||
      typeof value.ownerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.ownerId) ||
      typeof value.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.nonce) ||
      !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= now) return null
  return { ownerId: value.ownerId, nonce: value.nonce, expiresAt: value.expiresAt as number }
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header || header.length > 8_192) return null
  for (const piece of header.split(';')) {
    const [name, ...rest] = piece.trim().split('=')
    if (name === DOCUMENT_SESSION_COOKIE) return rest.join('=') || null
  }
  return null
}

export function hostedSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${DOCUMENT_SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`
}

export function isHostedSessionLogin(value: unknown, configuredPolicyVersion: string | undefined): value is HostedSessionLogin {
  return isRecord(value) && Object.keys(value).sort().join(',') === 'accessToken,inviteId,policyAccepted,policyVersion' &&
    typeof value.inviteId === 'string' && typeof value.accessToken === 'string' && value.policyAccepted === true &&
    typeof value.policyVersion === 'string' && value.policyVersion === configuredPolicyVersion
}

export function clearHostedSessionCookie(): string {
  return `${DOCUMENT_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

function unavailable() {
  return responseError('hosted_documents_unavailable', 'Hosted document access is unavailable.', 503)
}

function responseError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function readSessionBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_SESSION_REQUEST_BYTES)) {
    throw Object.assign(new Error('Session request is too large.'), { code: 'request_too_large', status: 413 })
  }
  if (!request.body) throw Object.assign(new Error('Session request body is required.'), { code: 'invalid_json', status: 400 })
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > MAX_SESSION_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw Object.assign(new Error('Session request is too large.'), { code: 'request_too_large', status: 413 })
    }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown } catch {
    throw Object.assign(new Error('Session request is invalid.'), { code: 'invalid_json', status: 400 })
  }
}

function controlResponse(error: unknown): Response {
  const known = error as Partial<HostedControlError>
  if (typeof known.status === 'number' && typeof known.code === 'string') {
    return responseError(known.code, known.message || 'Hosted document access is unavailable.', known.status)
  }
  return unavailable()
}

export function hostedModeStatus(): 'disabled' | 'invalid' | 'enabled' {
  const result = readHostedDocumentConfig()
  return result.mode
}

export async function resolveHostedRequest(request: Request, mutation = false, countRequest = true): Promise<HostedRequestResolution> {
  if (readDocumentRuntimeMode() !== 'hosted') return { mode: 'unavailable', response: unavailable() }
  const result = readHostedDocumentConfig()
  if (result.mode === 'disabled') return { mode: 'disabled' }
  if (result.mode === 'invalid') return { mode: 'unavailable', response: unavailable() }
  const { config } = result
  if (Buffer.byteLength(request.url, 'utf8') > MAX_DOCUMENT_URL_BYTES) {
    return { mode: 'unavailable', response: responseError('url_too_large', 'Request URL exceeds the document API limit.', 414) }
  }
  if (!hostedRequestOriginAllowed(request, config, mutation)) {
    return { mode: 'unavailable', response: responseError('hosted_origin_rejected', 'Request origin is not allowed.', 403) }
  }
  const token = cookieValue(request)
  const claims = token ? verifyHostedSessionToken(token, config.sessionSecret) : null
  if (!claims) return { mode: 'unavailable', response: responseError('hosted_session_required', 'A valid demo session is required.', 401) }
  try {
    if (countRequest) await authorizeOwnerSessionAndRecordRequest(claims, config)
    else if (!(await isCurrentOwnerSession(claims))) throw Object.assign(new Error('Invalid session.'), { code: 'invalid_session', status: 401 })
    return { mode: 'authenticated', config, session: claims }
  } catch (error) {
    return { mode: 'unavailable', response: controlResponse(error) }
  }
}

async function isCurrentOwnerSession(session: HostedSessionClaims): Promise<boolean> {
  return validateOwnerSession(session)
}

export async function createHostedSessionResponse(request: Request): Promise<Response> {
  if (readDocumentRuntimeMode() !== 'hosted') return unavailable()
  const result = readHostedDocumentConfig()
  if (result.mode !== 'enabled') return unavailable()
  const { config } = result
  if (Buffer.byteLength(request.url, 'utf8') > MAX_DOCUMENT_URL_BYTES || !hostedRequestOriginAllowed(request, config, true)) {
    return responseError('hosted_origin_rejected', 'Request origin is not allowed.', 403)
  }
  try { await recordHostedRequest(null, config) } catch (error) { return controlResponse(error) }
  let body: unknown
  try { body = await readSessionBody(request) } catch (error) {
    const known = error as { status?: number; code?: string; message?: string }
    return responseError(known.code || 'invalid_json', known.message || 'Session request is invalid.', known.status || 400)
  }
  if (!isHostedSessionLogin(body, process.env.EZAGENT_DOCUMENTS_POLICY_VERSION)) {
    return responseError('invalid_session_request', 'Session request is invalid.', 400)
  }
  const invite = config.invites.find((entry) => entry.id === body.inviteId && inviteTokenMatches(body.accessToken, entry.token))
  if (!invite) return responseError('hosted_session_required', 'Invite credentials were not accepted.', 401)
  try {
    const session = await issueOwnerSession(invite.id, config)
    const token = signHostedSession(session, config.sessionSecret)
    return Response.json({ data: { expiresAt: session.expiresAt, policyVersion: process.env.EZAGENT_DOCUMENTS_POLICY_VERSION } }, {
      headers: { 'Cache-Control': 'no-store', 'Set-Cookie': hostedSessionCookie(token, config.sessionTtlSeconds), 'Referrer-Policy': 'no-referrer' },
    })
  } catch (error) { return controlResponse(error) }
}

export async function getHostedSessionResponse(request: Request): Promise<Response> {
  const resolution = await resolveHostedRequest(request, false)
  if (resolution.mode === 'unavailable') return resolution.response
  if (resolution.mode === 'disabled') return unavailable()
  return Response.json({ data: { expiresAt: resolution.session.expiresAt, policyVersion: process.env.EZAGENT_DOCUMENTS_POLICY_VERSION } }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function revokeHostedSessionResponse(request: Request): Promise<Response> {
  if (readDocumentRuntimeMode() !== 'hosted') return unavailable()
  const resolution = await resolveHostedRequest(request, true, false)
  if (resolution.mode === 'unavailable') {
    const configured = readHostedDocumentConfig()
    if (configured.mode !== 'enabled' || !hostedRequestOriginAllowed(request, configured.config, true)) return resolution.response
    const headers = new Headers(resolution.response.headers)
    headers.set('Set-Cookie', clearHostedSessionCookie())
    return new Response(resolution.response.body, { status: resolution.response.status, statusText: resolution.response.statusText, headers })
  }
  if (resolution.mode === 'disabled') return unavailable()
  try {
    await revokeOwnerSession(resolution.session)
    return Response.json({ data: { revoked: true } }, {
      headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearHostedSessionCookie() },
    })
  } catch { return unavailable() }
}
