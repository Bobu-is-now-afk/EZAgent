import { createHash, timingSafeEqual } from 'node:crypto'
import { documentPolicyAvailable } from './policy'

export type HostedInvite = { id: string; token: string }

export type HostedDocumentConfig = {
  invites: HostedInvite[]
  sessionSecret: string
  allowedOrigin: string
  sessionTtlSeconds: number
  maxOwners: number
  requestsPerMinute: number
  globalRequestsPerMinute: number
  dailySuggestions: number
  maxActiveSuggestions: 1
  maxQueue: number
  maxQueueWaitMs: number
  suggestionTimeoutMs: number
}

export type HostedConfigResult =
  | { mode: 'disabled' }
  | { mode: 'invalid' }
  | { mode: 'enabled'; config: HostedDocumentConfig }

function boundedInt(value: string | undefined, min: number, max: number): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function parseInvites(value: string | undefined): HostedInvite[] | null {
  if (!value) return null
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 10) return null
  const ids = new Set<string>()
  const tokenHashes = new Set<string>()
  const invites: HostedInvite[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).sort().join(',') !== 'id,token' ||
        typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) ||
        typeof item.token !== 'string' || Buffer.byteLength(item.token, 'utf8') < 32 || Buffer.byteLength(item.token, 'utf8') > 256) return null
    const hash = createHash('sha256').update(item.token, 'utf8').digest('hex')
    if (ids.has(item.id) || tokenHashes.has(hash)) return null
    ids.add(item.id); tokenHashes.add(hash)
    invites.push({ id: item.id, token: item.token })
  }
  return invites
}

export function readHostedDocumentConfig(env: NodeJS.ProcessEnv = process.env): HostedConfigResult {
  const flag = env.EZAGENT_HOSTED_DOCUMENTS_ENABLED
  if (flag === undefined || flag === '0') return { mode: 'disabled' }
  if (flag !== '1') return { mode: 'invalid' }

  const invites = parseInvites(env.EZAGENT_DOCUMENTS_ACCESS_TOKENS_JSON)
  const secret = env.EZAGENT_DOCUMENTS_SESSION_SECRET
  const origin = env.EZAGENT_DOCUMENTS_ALLOWED_ORIGIN
  const policyVersion = env.EZAGENT_DOCUMENTS_POLICY_VERSION
  let parsedOrigin: URL | null = null
  try { parsedOrigin = origin ? new URL(origin) : null } catch { parsedOrigin = null }
  if (!invites || !secret || Buffer.byteLength(secret, 'utf8') < 32 || Buffer.byteLength(secret, 'utf8') > 256 ||
      !parsedOrigin || parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin ||
      parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash || parsedOrigin.username || parsedOrigin.password ||
      !documentPolicyAvailable(policyVersion)) return { mode: 'invalid' }

  const sessionTtlSeconds = boundedInt(env.EZAGENT_DOCUMENTS_SESSION_TTL_SECONDS, 300, 28_800)
  const maxOwners = boundedInt(env.EZAGENT_DOCUMENTS_MAX_OWNERS, 1, 10)
  const requestsPerMinute = boundedInt(env.EZAGENT_DOCUMENTS_REQUESTS_PER_MINUTE, 1, 30)
  const globalRequestsPerMinute = boundedInt(env.EZAGENT_DOCUMENTS_GLOBAL_REQUESTS_PER_MINUTE, 1, 300)
  const dailySuggestions = boundedInt(env.EZAGENT_DOCUMENTS_DAILY_SUGGESTIONS, 1, 20)
  const maxActiveSuggestions = boundedInt(env.EZAGENT_DOCUMENTS_MAX_ACTIVE_SUGGESTIONS, 1, 1)
  const maxQueue = boundedInt(env.EZAGENT_DOCUMENTS_MAX_QUEUE, 0, 2)
  const maxQueueWaitMs = boundedInt(env.EZAGENT_DOCUMENTS_MAX_QUEUE_WAIT_MS, 0, 15_000)
  const suggestionTimeoutMs = boundedInt(env.EZAGENT_DOCUMENTS_SUGGESTION_TIMEOUT_MS, 1_000, 30_000)
  if ([sessionTtlSeconds, maxOwners, requestsPerMinute, globalRequestsPerMinute, dailySuggestions,
    maxActiveSuggestions, maxQueue, maxQueueWaitMs, suggestionTimeoutMs].some((value) => value === null) ||
      maxOwners! > invites.length) return { mode: 'invalid' }

  return {
    mode: 'enabled',
    config: {
      invites, sessionSecret: secret, allowedOrigin: origin!, sessionTtlSeconds: sessionTtlSeconds!,
      maxOwners: maxOwners!, requestsPerMinute: requestsPerMinute!, globalRequestsPerMinute: globalRequestsPerMinute!,
      dailySuggestions: dailySuggestions!, maxActiveSuggestions: 1, maxQueue: maxQueue!,
      maxQueueWaitMs: maxQueueWaitMs!, suggestionTimeoutMs: suggestionTimeoutMs!,
    },
  }
}

export function inviteTokenMatches(candidate: string, expected: string): boolean {
  const left = createHash('sha256').update(candidate, 'utf8').digest()
  const right = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(left, right)
}

export function hostedRequestOriginAllowed(request: Request, config: HostedDocumentConfig, mutation: boolean): boolean {
  let requestUrl: URL
  try { requestUrl = new URL(request.url) } catch { return false }
  const ownerKeys = new Set(['owner', 'ownerid', 'tenant', 'tenantid', 'organization', 'organizationid'])
  if ([...requestUrl.searchParams.keys()].some((key) => ownerKeys.has(key.toLowerCase())) ||
      ['x-owner-id', 'x-tenant-id', 'x-organization-id', 'x-ezagent-owner-id'].some((key) => request.headers.has(key))) return false
  if (requestUrl.protocol !== 'https:' || requestUrl.origin !== config.allowedOrigin ||
      request.headers.get('host')?.toLowerCase() !== requestUrl.host.toLowerCase()) return false
  const origin = request.headers.get('origin')
  if (origin && origin !== config.allowedOrigin) return false
  if (mutation && origin !== config.allowedOrigin) return false
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  return true
}
