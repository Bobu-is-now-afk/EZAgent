import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

import { DEMO_SESSION_COOKIE, demoConfig, issueDemoSession, isCorrectAccessCode, verifyDemoSession } from '../../lib/demo/access-control'
import { acquireDemoModelSlot, DemoLimitError, reserveDemoOperation } from '../../lib/demo/limits'
import { createDemoPlanQueue, DEMO_PLAN_QUEUE } from '../../lib/demo/jobs'
import { proxy } from '../../proxy'
import { GET as getDemoSession, POST as postDemoSession, DELETE as deleteDemoSession } from '../../app/api/demo/session/route'
import { GET as getDemoCapabilities } from '../../app/api/demo/capabilities/route'

const validEnv = {
  NODE_ENV: 'production',
  EZAGENT_DEMO_ENABLED: '1',
  EZAGENT_DEMO_RELEASE_APPROVED: '1',
  EZAGENT_DEMO_ORIGIN: 'https://demo.example.test',
  EZAGENT_DEMO_DATA_POLICY_URL: '/demo-data-policy',
  EZAGENT_DEMO_ACCESS_CODE: 'test-only-access-code-should-never-be-deployed',
  EZAGENT_SESSION_SECRET: 'test-only-session-secret-for-unit-tests-not-production',
} as const

function useEnv(t: { after(callback: () => void): void }, overrides: Record<string, string | undefined> = {}) {
  const keys = Object.keys(validEnv)
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) {
    if (Object.hasOwn(overrides, key)) {
      const value = overrides[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    } else process.env[key] = validEnv[key as keyof typeof validEnv]
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!keys.includes(key)) {
      previous.set(key, process.env[key])
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

test('hosted demo stays closed unless the stop switch, release gate, origin, secrets, and policy URL are present', () => {
  const configured = demoConfig(validEnv)
  assert.equal(configured?.origin, validEnv.EZAGENT_DEMO_ORIGIN)
  assert.equal(configured?.dataPolicyUrl, validEnv.EZAGENT_DEMO_DATA_POLICY_URL)
  assert.equal(demoConfig({ ...validEnv, EZAGENT_DEMO_ENABLED: '0' }), null)
  assert.equal(demoConfig({ ...validEnv, EZAGENT_DEMO_RELEASE_APPROVED: '0' }), null)
  assert.equal(demoConfig({ ...validEnv, EZAGENT_DEMO_ORIGIN: 'http://demo.example.test' }), null)
  assert.equal(demoConfig({ ...validEnv, EZAGENT_SESSION_SECRET: 'short' }), null)
  assert.equal(demoConfig({ ...validEnv, EZAGENT_DEMO_DATA_POLICY_URL: 'https://other.example.test/policy' }), null)
})

test('demo session signatures bind a random visitor ID and expire after four hours', () => {
  const config = { origin: validEnv.EZAGENT_DEMO_ORIGIN, accessCode: validEnv.EZAGENT_DEMO_ACCESS_CODE, sessionSecret: validEnv.EZAGENT_SESSION_SECRET, dataPolicyUrl: validEnv.EZAGENT_DEMO_DATA_POLICY_URL }
  const now = Date.UTC(2026, 9, 14, 12)
  const issued = issueDemoSession(config, now)
  assert.match(issued.ownerId, /^[0-9a-f-]{36}$/)
  assert.equal(verifyDemoSession(issued.token, config, now), issued.ownerId)
  assert.equal(verifyDemoSession(issued.token, config, now + 4 * 60 * 60 * 1000), null)
  assert.equal(verifyDemoSession(`${issued.token}x`, config, now), null)
  assert.equal(isCorrectAccessCode(validEnv.EZAGENT_DEMO_ACCESS_CODE, config), true)
  assert.equal(isCorrectAccessCode('wrong-code', config), false)
})

test('session endpoints issue only HttpOnly secure same-site cookies and support status/logout', async (t) => {
  useEnv(t)
  const login = await postDemoSession(new Request(`${validEnv.EZAGENT_DEMO_ORIGIN}/api/demo/session`, {
    method: 'POST', headers: { origin: validEnv.EZAGENT_DEMO_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ code: validEnv.EZAGENT_DEMO_ACCESS_CODE }),
  }))
  assert.equal(login.status, 200)
  const setCookie = login.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /^ezagent_demo_session=[^;]+;/)
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /Secure/)
  assert.match(setCookie, /SameSite=Strict/)
  assert.equal((await login.clone().text()).includes(validEnv.EZAGENT_DEMO_ACCESS_CODE), false)
  const cookie = setCookie.split(';', 1)[0]
  const status = await getDemoSession(new Request(`${validEnv.EZAGENT_DEMO_ORIGIN}/api/demo/session`, { headers: { cookie } }))
  assert.deepEqual(await status.json(), { authenticated: true })
  const logout = await deleteDemoSession(new Request(`${validEnv.EZAGENT_DEMO_ORIGIN}/api/demo/session`, { method: 'DELETE', headers: { origin: validEnv.EZAGENT_DEMO_ORIGIN } }))
  assert.equal(logout.status, 204)
  assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/)
  const invalidOrigin = await postDemoSession(new Request(`${validEnv.EZAGENT_DEMO_ORIGIN}/api/demo/session`, {
    method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify({ code: validEnv.EZAGENT_DEMO_ACCESS_CODE }),
  }))
  assert.equal(invalidOrigin.status, 403)
})

test('public capabilities are closed and non-executable before explicit release configuration', async (t) => {
  useEnv(t, { EZAGENT_DEMO_ENABLED: undefined, EZAGENT_DEMO_RELEASE_APPROVED: undefined })
  const response = await getDemoCapabilities()
  const body = await response.json()
  assert.equal(body.status, 'disabled')
  assert.equal(body.capabilities.invoicePlan, false)
  assert.equal(body.capabilities.invoicePlanQueue, false)
  assert.equal(body.capabilities.invoiceRun, false)
  assert.equal(body.capabilities.chat, false)
})

test('production proxy rejects unauthenticated requests to every stateful or model API', (t) => {
  useEnv(t)
  const paths: Array<[string, string]> = [
    ['POST', '/api/demo/jobs'], ['POST', '/api/agent/runs'], ['GET', '/api/agent/runs/known-run'],
    ['GET', '/api/agent/runs/known-run/events'], ['GET', '/api/agent/runs/known-run/stream'],
    ['GET', '/api/agent/runs/known-run/artifacts/known-artifact'], ['POST', '/api/agent/runs/known-run/cancel'],
    ['POST', '/api/agent/runs/known-run/resume'], ['GET', '/api/demo-invoices'], ['POST', '/api/demo/jobs'],
    ['GET', '/api/demo/jobs/known-job'], ['DELETE', '/api/demo/jobs/known-job'],
  ]
  for (const [method, path] of paths) {
    const request = new NextRequest(`https://demo.example.test${path}`, {
      method,
      headers: { origin: validEnv.EZAGENT_DEMO_ORIGIN, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    })
    const response = proxy(request) as Response
    assert.equal(response.status, 401, `${method} ${path} must require a visitor session`)
  }
})

test('production proxy rejects forged owner headers, cross-origin requests, local model preparation, and hosted chat', (t) => {
  useEnv(t)
  const config = demoConfig()!
  const session = issueDemoSession(config)
  const request = new NextRequest('https://demo.example.test/api/agent/runs', {
    method: 'POST',
    headers: {
      origin: validEnv.EZAGENT_DEMO_ORIGIN,
      cookie: `${DEMO_SESSION_COOKIE}=${session.token}`,
      'x-ezagent-demo-owner': 'attacker-controlled-owner-id',
      'content-type': 'application/json',
    },
    body: '{}',
  })
  const response = proxy(request) as Response
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-middleware-request-x-ezagent-demo-owner'), session.ownerId)

  const foreignOrigin = new NextRequest('https://demo.example.test/api/agent/runs', {
    method: 'POST', headers: { origin: 'https://evil.example.test', cookie: `${DEMO_SESSION_COOKIE}=${session.token}` }, body: '{}',
  })
  assert.equal((proxy(foreignOrigin) as Response).status, 403)

  const localAi = new NextRequest('https://demo.example.test/api/local-ai', {
    method: 'POST', headers: { origin: validEnv.EZAGENT_DEMO_ORIGIN, cookie: `${DEMO_SESSION_COOKIE}=${session.token}` }, body: '{}',
  })
  assert.equal((proxy(localAi) as Response).status, 404)
  const hostedChat = new NextRequest('https://demo.example.test/api/chat', {
    method: 'POST', headers: { origin: validEnv.EZAGENT_DEMO_ORIGIN, cookie: `${DEMO_SESSION_COOKIE}=${session.token}` }, body: '{}',
  })
  assert.equal((proxy(hostedChat) as Response).status, 404)
})

test('proxy rejects declared payloads above 1 MiB before route handling', (t) => {
  useEnv(t)
  const request = new NextRequest('https://demo.example.test/api/demo/jobs', {
    method: 'POST',
    headers: { origin: validEnv.EZAGENT_DEMO_ORIGIN, 'content-length': String(1_048_577) },
    body: '{}',
  })
  assert.equal((proxy(request) as Response).status, 413)
})

test('production stop switch denies API work and anonymous capabilities remain non-executable', (t) => {
  useEnv(t, { EZAGENT_DEMO_ENABLED: undefined, EZAGENT_DEMO_RELEASE_APPROVED: undefined })
  const request = new NextRequest('https://demo.example.test/api/agent/plans', { method: 'POST', body: '{}' })
  assert.equal((proxy(request) as Response).status, 503)
})

test('demo usage has per-session minute and persisted UTC-day ceilings', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-limit-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const owner = `visitor_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const now = Date.UTC(2026, 9, 14, 12)
  for (let minute = 0; minute < 10; minute += 1) await reserveDemoOperation(owner, 'run', root, now)
  await assert.rejects(reserveDemoOperation(owner, 'run', root, now), (error) => error instanceof DemoLimitError && error.code === 'demo_rate_limited')

  for (let call = 10; call < 20; call += 1) await reserveDemoOperation(owner, 'run', root, now + call * 60_000)
  await assert.rejects(reserveDemoOperation(owner, 'run', root, now + 20 * 60_000), (error) => error instanceof DemoLimitError && error.code === 'demo_daily_limit')
  const stored = await readFile(join(root, 'demo-usage.json'), 'utf8')
  assert.equal(stored.includes(owner), false)
  assert.equal(JSON.parse(stored).total, 20)
})

test('demo usage enforces the global UTC-day ceiling and fails closed on inconsistent totals', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-global-limit-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const now = Date.UTC(2026, 9, 14, 12)
  for (let visitor = 0; visitor < 5; visitor += 1) {
    for (let call = 0; call < 20; call += 1) {
      await reserveDemoOperation(`global-${visitor}`, 'model', root, now + call * 60_000)
    }
  }
  await assert.rejects(reserveDemoOperation('global-overflow', 'model', root, now), (error) => error instanceof DemoLimitError && error.code === 'demo_daily_limit')
  const snapshotPath = join(root, 'demo-usage.json')
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
  snapshot.total += 1
  await writeFile(snapshotPath, JSON.stringify(snapshot))
  await assert.rejects(reserveDemoOperation('corrupt-total', 'model', root, now + 20 * 60_000), (error) => error instanceof DemoLimitError && error.code === 'demo_usage_unavailable')
})

test('the process-wide model slot rejects a second concurrent request and releases once', () => {
  const firstRelease = acquireDemoModelSlot()
  assert.throws(() => acquireDemoModelSlot(), (error) => error instanceof DemoLimitError && error.code === 'demo_busy')
  firstRelease()
  firstRelease()
  const secondRelease = acquireDemoModelSlot()
  secondRelease()
})

test('plan jobs expose FIFO positions, enforce the pending cap, and allow only their owner to cancel', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-queue-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const started: string[] = []
  const resolvers = new Map<string, () => void>()
  let dailyReservations = 0
  const queue = createDemoPlanQueue(root, async (payload, signal) => {
    const key = String(payload)
    started.push(key)
    await new Promise<void>((resolve, reject) => {
      resolvers.set(key, resolve)
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    return { workflow: { goal: key }, preview: { source: { rowCount: 0 }, stepCount: 5 } } as never
  })

  const first = await queue.submit('visitor-a', 'first', async () => { dailyReservations += 1 })
  await waitUntil(async () => started.includes('first'))
  const second = await queue.submit('visitor-b', 'second', async () => { dailyReservations += 1 })
  const third = await queue.submit('visitor-c', 'third', async () => { dailyReservations += 1 })
  assert.equal(second.status, 'queued')
  assert.equal(second.position, 1)
  assert.equal(third.position, 2)
  await assert.rejects(queue.submit('visitor-d', 'fourth', async () => { dailyReservations += 1 }), /demo_queue_full/)
  assert.equal(dailyReservations, 3, 'a rejected full-queue request must not consume daily plan quota')
  assert.equal(await queue.get(second.id, 'visitor-a'), null)
  assert.equal(await queue.cancel(second.id, 'visitor-a'), null)

  const cancelled = await queue.cancel(second.id, 'visitor-b')
  assert.equal(cancelled?.status, 'cancelled')
  assert.equal((await queue.get(third.id, 'visitor-c'))?.position, 1)
  assert.ok(['cancelling', 'cancelled'].includes((await queue.cancel(first.id, 'visitor-a'))?.status ?? ''))
  await waitUntil(async () => started.includes('third'))
  resolvers.get('third')?.()
  await waitUntil(async () => (await queue.get(third.id, 'visitor-c'))?.status === 'completed')
  assert.equal((await queue.get(first.id, 'visitor-a'))?.status, 'cancelled')
  await queue.flush()
  const persisted = await readFile(join(root, 'demo-jobs.json'), 'utf8')
  assert.equal(persisted.includes('first'), false)
  assert.equal(persisted.includes('second'), false)
  assert.equal(persisted.includes('third'), false)
})

test('concurrent plan submissions cannot exceed one active worker plus the pending capacity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-queue-admission-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const queue = createDemoPlanQueue(root, async (_payload, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  const submissions = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => queue.submit(`admission-${index}`, { index })))
  const accepted = submissions.flatMap((submission) => submission.status === 'fulfilled' ? [submission.value] : [])
  const rejected = submissions.filter((submission) => submission.status === 'rejected')
  assert.equal(accepted.length + rejected.length, 12)
  assert.ok(accepted.length <= DEMO_PLAN_QUEUE.maxConcurrent + DEMO_PLAN_QUEUE.maxPending)
  assert.equal(rejected.length, 12 - accepted.length)
  const status = await queue.status()
  assert.ok(status.queued <= DEMO_PLAN_QUEUE.maxPending)
  assert.ok(status.active <= DEMO_PLAN_QUEUE.maxConcurrent)
  for (const [index, job] of accepted.entries()) await queue.cancel(job.id, `admission-${index}`)
  for (const [index, job] of accepted.entries()) await waitUntil(async () => (await queue.get(job.id, `admission-${index}`))?.status === 'cancelled')
  await queue.flush()
})

test('plan queue marks queued and running jobs interrupted after restart and expires overdue queued jobs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-recovery-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(root, { recursive: true })
  const id = '10000000-0000-4000-8000-000000000001'
  const ownerId = 'visitor-recovery'
  const ownerHash = createHash('sha256').update(ownerId).digest('hex')
  const timestamp = new Date(Date.now()).toISOString()
  await writeFile(join(root, 'demo-jobs.json'), JSON.stringify({ version: 1, jobs: [
    { id, type: 'plan', ownerHash, status: 'running', position: null, createdAt: timestamp, updatedAt: timestamp },
  ] }), { mode: 0o600 })
  const restored = createDemoPlanQueue(root, async () => { throw new Error('must not rerun interrupted work') })
  const recovered = await restored.get(id, ownerId)
  assert.equal(recovered?.status, 'interrupted')
  assert.equal(recovered?.errorCode, 'process_restarted')
  assert.equal(recovered?.result, undefined)

  let currentTime = Date.UTC(2026, 9, 14, 12)
  const timeoutRoot = await mkdtemp(join(tmpdir(), 'ezagent-demo-queue-timeout-test-'))
  t.after(() => rm(timeoutRoot, { recursive: true, force: true }))
  let release!: () => void
  const planner = async (_payload: unknown, signal?: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      release = resolve
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    return { workflow: {}, preview: {} } as never
  }
  const quickLimits = { ...DEMO_PLAN_QUEUE, maxPending: 1, queueTimeoutMs: 100, jobTimeoutMs: 10_000 }
  const queue = createDemoPlanQueue(timeoutRoot, planner, () => currentTime, quickLimits)
  const active = await queue.submit('owner-1', 'active')
  await waitUntil(async () => (await queue.get(active.id, 'owner-1'))?.status === 'running')
  const waiting = await queue.submit('owner-2', 'waiting')
  currentTime += 101
  release()
  await waitUntil(async () => (await queue.get(waiting.id, 'owner-2'))?.status === 'failed')
  assert.equal((await queue.get(waiting.id, 'owner-2'))?.errorCode, 'queue_timeout')
  await queue.flush()
})

test('plan queue reports planner timeouts as failed instead of completed or cancelled', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-job-timeout-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const queue = createDemoPlanQueue(root, async (_payload, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }), Date.now, { ...DEMO_PLAN_QUEUE, jobTimeoutMs: 20 })
  const job = await queue.submit('timeout-owner', { prompt: 'test' })
  await waitUntil(async () => (await queue.get(job.id, 'timeout-owner'))?.status === 'failed')
  const failed = await queue.get(job.id, 'timeout-owner')
  assert.equal(failed?.errorCode, 'planner_timeout')
  assert.equal(failed?.result, undefined)
})

test('plan queue clears its running lock when the running-state snapshot cannot be written', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-job-storage-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let writes = 0
  let plannerCalls = 0
  const queue = createDemoPlanQueue(root, async () => {
    plannerCalls += 1
    return { workflow: {}, preview: {} } as never
  }, Date.now, DEMO_PLAN_QUEUE, async (pathname, contents) => {
    writes += 1
    if (writes === 2) throw new Error('injected_storage_failure')
    await writeFile(pathname, contents, { mode: 0o600 })
  })
  const accepted = await queue.submit('storage-owner', { prompt: 'test' })
  await waitUntil(async () => (await queue.get(accepted.id, 'storage-owner'))?.status === 'failed')
  await queue.flush()
  const failed = await queue.get(accepted.id, 'storage-owner')
  assert.equal(failed?.errorCode, 'demo_job_storage_failed')
  assert.equal(plannerCalls, 0)
  assert.deepEqual(await queue.status(), { active: 0, queued: 0 })
  await assert.rejects(queue.submit('storage-owner', { prompt: 'retry' }), /demo_job_storage_failed/)
})

test('job metadata is pruned at the retention boundary during a long-lived process', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-demo-job-retention-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let currentTime = Date.now()
  const queue = createDemoPlanQueue(root, async () => ({ workflow: {}, preview: {} }) as never, () => currentTime, { ...DEMO_PLAN_QUEUE, recordRetentionMs: 100 })
  const job = await queue.submit('retention-owner', { prompt: 'test' })
  await waitUntil(async () => (await queue.get(job.id, 'retention-owner'))?.status === 'completed')
  await queue.flush()
  currentTime += 101
  assert.equal(await queue.get(job.id, 'retention-owner'), null)
  const saved = JSON.parse(await readFile(join(root, 'demo-jobs.json'), 'utf8'))
  assert.deepEqual(saved.jobs, [])
})

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition did not become true before timeout')
}
