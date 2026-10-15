import { randomUUID } from 'node:crypto'
import type { HostedControlState } from './contracts'
import type { HostedDocumentConfig } from './hosted-config'
import { createHostedControlStore, type DocumentStore } from './store'

const MINUTE_MS = 60_000
const STALE_LEASE_GRACE_MS = 5_000

type OwnerSession = { ownerId: string; nonce: string; expiresAt: number }
type ControlErrorCode = 'global_rate_limited' | 'owner_rate_limited' | 'owner_cap' | 'daily_cap' | 'queue_full' | 'queue_timeout' | 'request_cancelled' | 'clock_rollback' | 'invalid_session'

export class HostedControlError extends Error {
  readonly code: ControlErrorCode
  readonly status: number
  constructor(code: ControlErrorCode, message: string, status: number) {
    super(message); this.name = 'HostedControlError'; this.code = code; this.status = status
  }
}

async function defaultControlStore(): Promise<DocumentStore> {
  return createHostedControlStore()
}

function advanceRequestWindow(control: HostedControlState, now: number): boolean {
  const minute = Math.floor(now / MINUTE_MS)
  if (minute < control.requestWindow.minute) return false
  if (minute > control.requestWindow.minute) control.requestWindow = { minute, globalCount: 0, byOwner: {} }
  return true
}

function consumeRequest(control: HostedControlState, ownerId: string | null, config: HostedDocumentConfig, now: number): ControlErrorCode | null {
  if (!advanceRequestWindow(control, now)) return 'clock_rollback'
  if (control.requestWindow.globalCount >= config.globalRequestsPerMinute) return 'global_rate_limited'
  if (ownerId && (control.requestWindow.byOwner[ownerId] ?? 0) >= config.requestsPerMinute) return 'owner_rate_limited'
  control.requestWindow.globalCount += 1
  if (ownerId) control.requestWindow.byOwner[ownerId] = (control.requestWindow.byOwner[ownerId] ?? 0) + 1
  return null
}

function pruneSessions(control: HostedControlState, now: number) {
  control.sessions = control.sessions.filter((session) => session.expiresAt > now && session.revokedAt === null)
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function pruneLeases(control: HostedControlState, now: number, config: HostedDocumentConfig) {
  control.activeSuggestions = control.activeSuggestions.filter((lease) => processIsAlive(lease.pid) &&
    now - lease.startedAt <= config.suggestionTimeoutMs + STALE_LEASE_GRACE_MS)
  control.queuedSuggestions = control.queuedSuggestions.filter((lease) => processIsAlive(lease.pid) &&
    now - lease.enqueuedAt <= config.maxQueueWaitMs)
}

function authError(code: ControlErrorCode): HostedControlError {
  if (code === 'invalid_session') return new HostedControlError(code, 'A valid demo session is required.', 401)
  if (code === 'owner_cap') return new HostedControlError(code, 'Hosted document demo is at its configured owner limit.', 503)
  if (code === 'daily_cap') return new HostedControlError(code, 'Daily suggestion limit reached for this demo workspace.', 429)
  if (code === 'queue_full') return new HostedControlError(code, 'Local AI is busy. Try again shortly.', 429)
  if (code === 'queue_timeout') return new HostedControlError(code, 'The local AI queue did not start before its wait limit.', 503)
  if (code === 'request_cancelled') return new HostedControlError(code, 'Request was cancelled.', 499)
  if (code === 'clock_rollback') return new HostedControlError(code, 'Hosted document controls are temporarily unavailable.', 503)
  return new HostedControlError(code, 'Too many document requests. Try again shortly.', 429)
}

export async function issueOwnerSession(
  inviteId: string,
  config: HostedDocumentConfig,
  now = Date.now(),
  storeProvider = defaultControlStore,
): Promise<OwnerSession> {
  const store = await storeProvider()
  const result = await store.updateHostedControl((control) => {
    pruneSessions(control, now)
    let owner = control.inviteOwners.find((entry) => entry.inviteId === inviteId)
    if (!owner) {
      if (control.inviteOwners.length >= config.maxOwners) return { ok: false as const, error: 'owner_cap' as const }
      owner = { inviteId, ownerId: randomUUID(), createdAt: now }
      control.inviteOwners.push(owner)
    }
    const nonce = randomUUID()
    control.sessions = control.sessions.filter((session) => session.ownerId !== owner!.ownerId)
    control.sessions.push({ nonce, ownerId: owner.ownerId, expiresAt: now + config.sessionTtlSeconds * 1000, revokedAt: null })
    return { ok: true as const, session: { ownerId: owner.ownerId, nonce, expiresAt: now + config.sessionTtlSeconds * 1000 } }
  })
  if (!result.ok) throw authError(result.error)
  return result.session
}

export async function validateOwnerSession(
  session: OwnerSession,
  now = Date.now(),
  storeProvider = defaultControlStore,
): Promise<boolean> {
  if (!isUuid(session.ownerId) || !isUuid(session.nonce) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now) return false
  const control = await (await storeProvider()).readHostedControl()
  const ownerExists = control.inviteOwners.some((entry) => entry.ownerId === session.ownerId)
  const validSession = control.sessions.some((entry) => entry.ownerId === session.ownerId && entry.nonce === session.nonce &&
    entry.expiresAt === session.expiresAt && entry.expiresAt > now && entry.revokedAt === null)
  return ownerExists && validSession
}

export async function authorizeOwnerSessionAndRecordRequest(
  session: OwnerSession,
  config: HostedDocumentConfig,
  now = Date.now(),
  storeProvider = defaultControlStore,
): Promise<void> {
  if (!isUuid(session.ownerId) || !isUuid(session.nonce) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now) {
    throw authError('invalid_session')
  }
  const store = await storeProvider()
  const result = await store.updateHostedControl((control) => {
    const ownerExists = control.inviteOwners.some((entry) => entry.ownerId === session.ownerId &&
      config.invites.some((invite) => invite.id === entry.inviteId))
    const validSession = control.sessions.some((entry) => entry.ownerId === session.ownerId && entry.nonce === session.nonce &&
      entry.expiresAt === session.expiresAt && entry.expiresAt > now && entry.revokedAt === null)
    if (!ownerExists || !validSession) return 'invalid_session' as const
    return consumeRequest(control, session.ownerId, config, now)
  })
  if (result) throw authError(result)
}

export async function revokeOwnerSession(
  session: OwnerSession,
  now = Date.now(),
  storeProvider = defaultControlStore,
): Promise<void> {
  const store = await storeProvider()
  await store.updateHostedControl((control) => {
    const current = control.sessions.find((entry) => entry.ownerId === session.ownerId && entry.nonce === session.nonce)
    if (current) current.revokedAt = now
  })
}

export async function recordHostedRequest(
  ownerId: string | null,
  config: HostedDocumentConfig,
  now = Date.now(),
  storeProvider = defaultControlStore,
): Promise<void> {
  const store = await storeProvider()
  const error = await store.updateHostedControl((control) => consumeRequest(control, ownerId, config, now))
  if (error) throw authError(error)
}

async function reserveSuggestion(ownerId: string, config: HostedDocumentConfig, id: string, now: number, store: DocumentStore) {
  return store.updateHostedControl((control) => {
    pruneLeases(control, now, config)
    const dayUTC = new Date(now).toISOString().slice(0, 10)
    if (dayUTC < control.dailySuggestions.dayUTC) return 'clock_rollback' as const
    if (dayUTC > control.dailySuggestions.dayUTC) control.dailySuggestions = { dayUTC, byOwner: {} }
    const count = control.dailySuggestions.byOwner[ownerId] ?? 0
    if (count >= config.dailySuggestions) return 'daily_cap' as const
    if (control.activeSuggestions.length < config.maxActiveSuggestions && control.queuedSuggestions.length === 0) {
      control.dailySuggestions.byOwner[ownerId] = count + 1
      control.activeSuggestions.push({ id, ownerId, pid: process.pid, startedAt: now })
      return 'active' as const
    }
    if (control.queuedSuggestions.length >= config.maxQueue) return 'queue_full' as const
    control.dailySuggestions.byOwner[ownerId] = count + 1
    control.queuedSuggestions.push({ id, ownerId, pid: process.pid, enqueuedAt: now })
    return 'queued' as const
  })
}

async function promoteOrRemoveSuggestion(id: string, config: HostedDocumentConfig, now: number, store: DocumentStore, remove: boolean) {
  return store.updateHostedControl((control) => {
    pruneLeases(control, now, config)
    if (remove) {
      control.queuedSuggestions = control.queuedSuggestions.filter((entry) => entry.id !== id)
      control.activeSuggestions = control.activeSuggestions.filter((entry) => entry.id !== id)
      return 'removed' as const
    }
    const position = control.queuedSuggestions.findIndex((entry) => entry.id === id)
    if (position !== 0 || control.activeSuggestions.length >= config.maxActiveSuggestions) return 'waiting' as const
    const queued = control.queuedSuggestions.shift()!
    control.activeSuggestions.push({ id: queued.id, ownerId: queued.ownerId, pid: queued.pid, startedAt: now })
    return 'active' as const
  })
}

export async function withHostedSuggestionSlot<T>(
  ownerId: string,
  config: HostedDocumentConfig,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
  storeProvider = defaultControlStore,
  nowProvider: () => number = Date.now,
): Promise<T> {
  const store = await storeProvider()
  const id = randomUUID()
  const firstState = await reserveSuggestion(ownerId, config, id, nowProvider(), store)
  if (firstState !== 'active' && firstState !== 'queued') throw authError(firstState)
  let active = firstState === 'active'
  const startedAt = nowProvider()
  try {
    while (!active) {
      if (signal?.aborted) throw authError('request_cancelled')
      const elapsed = nowProvider() - startedAt
      if (elapsed >= config.maxQueueWaitMs) throw authError('queue_timeout')
      const status = await promoteOrRemoveSuggestion(id, config, nowProvider(), store, false)
      active = status === 'active'
      if (!active) await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, config.maxQueueWaitMs - elapsed))))
    }
    if (signal?.aborted) throw authError('request_cancelled')
    return await operation()
  } finally {
    await promoteOrRemoveSuggestion(id, config, nowProvider(), store, true)
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
