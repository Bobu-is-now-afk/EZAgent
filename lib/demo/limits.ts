import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

export const DEMO_LIMITS = Object.freeze({
  maxRequestBytes: 1_048_576,
  maxSessionRequestsPerMinute: 10,
  maxReadRequestsPerMinute: 30,
  maxCallsPerVisitorPerUtcDay: 20,
  maxCallsPerUtcDay: 100,
  maxConcurrentModelCalls: 1,
  maxConcurrentRuns: 1,
})

export type DemoOperation = 'read' | 'write' | 'model' | 'run'

export class DemoLimitError extends Error {
  readonly code: 'demo_rate_limited' | 'demo_daily_limit' | 'demo_busy' | 'demo_usage_unavailable'
  readonly retryAfter?: number

  constructor(code: DemoLimitError['code'], retryAfter?: number) {
    super(code)
    this.name = 'DemoLimitError'
    this.code = code
    this.retryAfter = retryAfter
  }
}

type UsageSnapshot = { version: 1; utcDay: string; total: number; visitors: Record<string, number> }
type RateState = { minute: number; read: number; write: number }
type ProcessState = { queues: Map<string, Promise<void>>; rates: Map<string, RateState>; modelActive: number; loginMinute: number; loginAttempts: number; publicMinute: number; publicRequests: number }

const globalState = globalThis as typeof globalThis & { __ezagentDemoLimitsV1?: ProcessState }
const state = globalState.__ezagentDemoLimitsV1 ??= { queues: new Map(), rates: new Map(), modelActive: 0, loginMinute: 0, loginAttempts: 0, publicMinute: 0, publicRequests: 0 }

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

function visitorKey(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex')
}

async function withFileQueue<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = state.queues.get(root) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const queued = previous.then(() => gate)
  state.queues.set(root, queued)
  return previous.then(operation).finally(() => {
    release()
    if (state.queues.get(root) === queued) state.queues.delete(root)
  })
}

async function readUsage(pathname: string, today: string): Promise<UsageSnapshot> {
  let contents: string
  try {
    contents = await readFile(pathname, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, utcDay: today, total: 0, visitors: {} }
    throw new DemoLimitError('demo_usage_unavailable')
  }
  try {
    const parsed = JSON.parse(contents) as UsageSnapshot
    if (parsed.version !== 1 || typeof parsed.utcDay !== 'string' || !Number.isSafeInteger(parsed.total) || parsed.total < 0 ||
        !parsed.visitors || typeof parsed.visitors !== 'object' || Array.isArray(parsed.visitors) ||
        Object.entries(parsed.visitors).some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(value) || value < 0)) {
      throw new Error('invalid')
    }
    return parsed.utcDay === today ? parsed : { version: 1, utcDay: today, total: 0, visitors: {} }
  } catch {
    throw new DemoLimitError('demo_usage_unavailable')
  }
}

async function writeUsage(pathname: string, value: UsageSnapshot): Promise<void> {
  const temporary = path.join(path.dirname(pathname), `demo-usage.${randomUUID()}.tmp`)
  let file
  try {
    file = await open(temporary, 'wx', 0o600)
    await file.writeFile(JSON.stringify(value), 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await rename(temporary, pathname)
  } catch {
    if (file) await file.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw new DemoLimitError('demo_usage_unavailable')
  }
}

export async function reserveDemoDailyUsage(ownerId: string, root = path.resolve(process.cwd(), '.ezagent'), now = Date.now()): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const pathname = path.join(root, 'demo-usage.json')
  await withFileQueue(root, async () => {
    const today = utcDay(now)
    const snapshot = await readUsage(pathname, today)
    const hashedOwner = visitorKey(ownerId)
    if (snapshot.total !== Object.values(snapshot.visitors).reduce((total, count) => total + count, 0)) throw new DemoLimitError('demo_usage_unavailable')
    const visitorTotal = snapshot.visitors[hashedOwner] ?? 0
    if (snapshot.total >= DEMO_LIMITS.maxCallsPerUtcDay || visitorTotal >= DEMO_LIMITS.maxCallsPerVisitorPerUtcDay) {
      throw new DemoLimitError('demo_daily_limit', 60 * 60)
    }
    snapshot.total += 1
    snapshot.visitors[hashedOwner] = visitorTotal + 1
    await writeUsage(pathname, snapshot)
  })
}

export async function reserveDemoOperation(ownerId: string, operation: DemoOperation, root = path.resolve(process.cwd(), '.ezagent'), now = Date.now()): Promise<void> {
  const minute = Math.floor(now / 60_000)
  for (const [key, value] of state.rates) if (value.minute < minute - 1) state.rates.delete(key)
  const prior = state.rates.get(ownerId)
  const rate = prior?.minute === minute ? prior : { minute, read: 0, write: 0 }
  if (operation === 'read') {
    if (rate.read >= DEMO_LIMITS.maxReadRequestsPerMinute) throw new DemoLimitError('demo_rate_limited', 60 - Math.floor((now % 60_000) / 1000))
    rate.read += 1
    state.rates.set(ownerId, rate)
    return
  }
  if (rate.write >= DEMO_LIMITS.maxSessionRequestsPerMinute) throw new DemoLimitError('demo_rate_limited', 60 - Math.floor((now % 60_000) / 1000))
  rate.write += 1
  state.rates.set(ownerId, rate)

  if (operation === 'model' || operation === 'run') await reserveDemoDailyUsage(ownerId, root, now)
}

export function acquireDemoModelSlot(): () => void {
  if (state.modelActive >= DEMO_LIMITS.maxConcurrentModelCalls) throw new DemoLimitError('demo_busy', 5)
  state.modelActive += 1
  let released = false
  return () => {
    if (released) return
    released = true
    state.modelActive -= 1
  }
}

export async function withDemoModelSlot<T>(operation: () => Promise<T>): Promise<T> {
  const release = acquireDemoModelSlot()
  try {
    return await operation()
  } finally {
    release()
  }
}

export function isDemoModelBusy(): boolean {
  return state.modelActive >= DEMO_LIMITS.maxConcurrentModelCalls
}

export async function reserveLoginAttempt(now = Date.now()): Promise<boolean> {
  const minute = Math.floor(now / 60_000)
  if (state.loginMinute !== minute) {
    state.loginMinute = minute
    state.loginAttempts = 0
  }
  state.loginAttempts += 1
  return state.loginAttempts <= 10
}

export function reservePublicProbe(now = Date.now()): boolean {
  const minute = Math.floor(now / 60_000)
  if (state.publicMinute !== minute) {
    state.publicMinute = minute
    state.publicRequests = 0
  }
  state.publicRequests += 1
  return state.publicRequests <= 30
}

export function demoLimitResponse(error: unknown): Response | null {
  if (!(error instanceof DemoLimitError)) return null
  const status = error.code === 'demo_usage_unavailable' ? 503 : error.code === 'demo_busy' ? 503 : 429
  const message: Record<DemoLimitError['code'], string> = {
    demo_rate_limited: 'Too many demo requests. Please wait before trying again.',
    demo_daily_limit: 'The demo daily usage limit has been reached.',
    demo_busy: 'The demo model is busy. Please retry shortly.',
    demo_usage_unavailable: 'Demo usage control is unavailable; requests are paused.',
  }
  return Response.json({ error: { code: error.code, message: message[error.code] } }, {
    status,
    headers: { 'Cache-Control': 'no-store', ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) },
  })
}
