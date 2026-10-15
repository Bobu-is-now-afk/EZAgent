import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readHostedDocumentConfig, hostedRequestOriginAllowed, type HostedDocumentConfig } from '../../lib/documents/hosted-config'
import { withHostedSuggestionSlot, issueOwnerSession, recordHostedRequest, validateOwnerSession, revokeOwnerSession, authorizeOwnerSessionAndRecordRequest, HostedControlError } from '../../lib/documents/hosted-control'
import { DOCUMENT_POLICY_VERSION, documentPolicyAvailable } from '../../lib/documents/policy'
import { createDocumentStore, emptyHostedControlState } from '../../lib/documents/store'
import { createHostedSessionResponse, getHostedSessionResponse, revokeHostedSessionResponse, signHostedSession, verifyHostedSessionToken, hostedSessionCookie, isHostedSessionLogin, DOCUMENT_SESSION_COOKIE } from '../../lib/documents/hosted-session'
import { documentStoreForContext, handleDocumentApi, readDocumentJson, MAX_DOCUMENT_REQUEST_BYTES, DocumentApiError } from '../../lib/documents/api'
import { readDocumentRuntimeMode } from '../../lib/documents/runtime-mode'

const invites = [
  { id: 'judge-a', token: 'a'.repeat(40) },
  { id: 'judge-b', token: 'b'.repeat(40) },
]

function hostedEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    EZAGENT_DEPLOYMENT_MODE: 'hosted',
    EZAGENT_HOSTED_DOCUMENTS_ENABLED: '1',
    EZAGENT_DOCUMENTS_ACCESS_TOKENS_JSON: JSON.stringify(invites),
    EZAGENT_DOCUMENTS_SESSION_SECRET: 'test-only-session-secret-'.repeat(2),
    EZAGENT_DOCUMENTS_ALLOWED_ORIGIN: 'https://demo.example.test',
    EZAGENT_DOCUMENTS_POLICY_VERSION: DOCUMENT_POLICY_VERSION,
    EZAGENT_DOCUMENTS_SESSION_TTL_SECONDS: '3600',
    EZAGENT_DOCUMENTS_MAX_OWNERS: '2',
    EZAGENT_DOCUMENTS_REQUESTS_PER_MINUTE: '10',
    EZAGENT_DOCUMENTS_GLOBAL_REQUESTS_PER_MINUTE: '20',
    EZAGENT_DOCUMENTS_DAILY_SUGGESTIONS: '10',
    EZAGENT_DOCUMENTS_MAX_ACTIVE_SUGGESTIONS: '1',
    EZAGENT_DOCUMENTS_MAX_QUEUE: '1',
    EZAGENT_DOCUMENTS_MAX_QUEUE_WAIT_MS: '1000',
    EZAGENT_DOCUMENTS_SUGGESTION_TIMEOUT_MS: '2000',
    ...overrides,
  } as NodeJS.ProcessEnv
}

function config(overrides: Partial<HostedDocumentConfig> = {}) {
  const result = readHostedDocumentConfig(hostedEnv())
  assert.equal(result.mode, 'enabled')
  if (result.mode !== 'enabled') throw new Error('test config must be valid')
  return { ...result.config, ...overrides }
}

async function tempControlStore(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), 'ezagent-hosted-control-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return createDocumentStore(root)
}

test('hosted documents are default-off and invalid session, origin, policy, or limit configuration fails closed', () => {
  assert.deepEqual(readHostedDocumentConfig(hostedEnv({ EZAGENT_HOSTED_DOCUMENTS_ENABLED: undefined })).mode, 'disabled')
  assert.equal(documentPolicyAvailable(undefined), false)
  assert.equal(readHostedDocumentConfig(hostedEnv({ EZAGENT_DOCUMENTS_POLICY_VERSION: undefined })).mode, 'invalid')
  assert.equal(readHostedDocumentConfig(hostedEnv({ EZAGENT_DOCUMENTS_SESSION_SECRET: 'short' })).mode, 'invalid')
  assert.equal(readHostedDocumentConfig(hostedEnv({ EZAGENT_DOCUMENTS_ALLOWED_ORIGIN: 'http://demo.example.test' })).mode, 'invalid')
  assert.equal(readHostedDocumentConfig(hostedEnv({ EZAGENT_DOCUMENTS_REQUESTS_PER_MINUTE: '0' })).mode, 'invalid')
  assert.equal(readHostedDocumentConfig(hostedEnv({ EZAGENT_DOCUMENTS_MAX_OWNERS: '3' })).mode, 'invalid')
  assert.equal(readHostedDocumentConfig(hostedEnv({ EZAGENT_DOCUMENTS_ACCESS_TOKENS_JSON: JSON.stringify([invites[0], invites[0]]) })).mode, 'invalid')
  assert.equal(readHostedDocumentConfig(hostedEnv({ EZAGENT_HOSTED_DOCUMENTS_ENABLED: 'true' })).mode, 'invalid')
})

test('deployment mode is independent of the hosted feature flag and defaults production to hosted', () => {
  assert.equal(readDocumentRuntimeMode(hostedEnv()), 'hosted')
  assert.equal(readDocumentRuntimeMode(hostedEnv({ EZAGENT_DEPLOYMENT_MODE: 'local' })), 'local')
  assert.equal(readDocumentRuntimeMode(hostedEnv({ EZAGENT_DEPLOYMENT_MODE: 'typo' })), 'invalid')
  assert.equal(readDocumentRuntimeMode(hostedEnv({ EZAGENT_DEPLOYMENT_MODE: undefined, NODE_ENV: 'production' })), 'hosted')
  assert.equal(readDocumentRuntimeMode(hostedEnv({ EZAGENT_DEPLOYMENT_MODE: undefined, NODE_ENV: 'production', EZAGENT_LOCAL_APP_MODE: '1' })), 'hosted')
})

test('hosted origin checks require exact HTTPS host and reject client owner selectors', () => {
  const hosted = config()
  const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers: { host: new URL(url).host, ...headers } })
  assert.equal(hostedRequestOriginAllowed(request('https://demo.example.test/api/documents/orders'), hosted, false), true)
  assert.equal(hostedRequestOriginAllowed(request('https://demo.example.test/api/documents/orders', { origin: 'https://attacker.test' }), hosted, false), false)
  assert.equal(hostedRequestOriginAllowed(request('http://demo.example.test/api/documents/orders'), hosted, false), false)
  assert.equal(hostedRequestOriginAllowed(request('https://demo.example.test/api/documents/orders?ownerId=other'), hosted, false), false)
  assert.equal(hostedRequestOriginAllowed(request('https://demo.example.test/api/documents/orders', { 'x-ezagent-owner-id': 'other' }), hosted, false), false)
  assert.equal(hostedRequestOriginAllowed(request('https://demo.example.test/api/documents/orders', { origin: 'https://demo.example.test', 'sec-fetch-site': 'cross-site' }), hosted, true), false)
})

test('hosted API never falls back to local storage when session or policy configuration is unavailable', async (t) => {
  const keys = [
    'EZAGENT_HOSTED_DOCUMENTS_ENABLED', 'EZAGENT_DOCUMENTS_ACCESS_TOKENS_JSON', 'EZAGENT_DOCUMENTS_SESSION_SECRET',
    'EZAGENT_DOCUMENTS_ALLOWED_ORIGIN', 'EZAGENT_DOCUMENTS_POLICY_VERSION', 'EZAGENT_DOCUMENTS_SESSION_TTL_SECONDS',
    'EZAGENT_DOCUMENTS_MAX_OWNERS', 'EZAGENT_DOCUMENTS_REQUESTS_PER_MINUTE', 'EZAGENT_DOCUMENTS_GLOBAL_REQUESTS_PER_MINUTE',
    'EZAGENT_DOCUMENTS_DAILY_SUGGESTIONS', 'EZAGENT_DOCUMENTS_MAX_ACTIVE_SUGGESTIONS', 'EZAGENT_DOCUMENTS_MAX_QUEUE',
    'EZAGENT_DOCUMENTS_MAX_QUEUE_WAIT_MS', 'EZAGENT_DOCUMENTS_SUGGESTION_TIMEOUT_MS', 'EZAGENT_DOCUMENTS_ENABLED',
    'EZAGENT_DEPLOYMENT_MODE', 'EZAGENT_LOCAL_APP_MODE',
  ]
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  t.after(() => { for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  Object.assign(process.env, hostedEnv())
  delete process.env.EZAGENT_DOCUMENTS_ENABLED
  let called = false
  const localRequest = new Request('http://localhost:3000/api/documents/orders', { headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } })
  const rejected = await handleDocumentApi(localRequest, async () => { called = true; return { leaked: true } })
  assert.equal(rejected.status, 403)
  assert.equal(called, false)
  delete process.env.EZAGENT_DOCUMENTS_POLICY_VERSION
  const unavailable = await handleDocumentApi(new Request('https://demo.example.test/api/documents/orders', { headers: { host: 'demo.example.test' } }), async () => { called = true; return {} })
  assert.equal(unavailable.status, 503)
  assert.equal(called, false)
})

test('session endpoints require explicit hosted deployment mode even when hosted credentials are valid', async (t) => {
  const keys = Object.keys(hostedEnv())
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  const previousCwd = process.cwd()
  const root = await mkdtemp(path.join(tmpdir(), 'ezagent-hosted-session-boundary-'))
  const testStore = await createDocumentStore(path.join(root, 'hosted-control'))
  t.after(async () => {
    process.chdir(previousCwd)
    await rm(root, { recursive: true, force: true })
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  process.chdir(root)
  Object.assign(process.env, hostedEnv())
  const hostedConfig = config()
  const existingSession = await issueOwnerSession('judge-a', hostedConfig, Date.now(), async () => testStore)
  const token = signHostedSession(existingSession, hostedConfig.sessionSecret)
  const sessionRequest = (method: 'GET' | 'POST' | 'DELETE') => new Request('https://demo.example.test/api/documents/session', {
    method,
    headers: {
      host: 'demo.example.test', origin: 'https://demo.example.test',
      ...(method !== 'POST' ? { cookie: `${DOCUMENT_SESSION_COOKIE}=${token}` } : { 'content-type': 'application/json' }),
    },
    ...(method === 'POST' ? { body: JSON.stringify({ inviteId: 'judge-a', accessToken: 'a'.repeat(40), policyVersion: DOCUMENT_POLICY_VERSION, policyAccepted: true }) } : {}),
  })
  for (const mode of ['local', 'invalid']) {
    process.env.EZAGENT_DEPLOYMENT_MODE = mode
    assert.equal((await createHostedSessionResponse(sessionRequest('POST'))).status, 503, `${mode} POST must not issue a session`)
    assert.equal((await getHostedSessionResponse(sessionRequest('GET'))).status, 503, `${mode} GET must not expose hosted session state`)
    assert.equal((await revokeHostedSessionResponse(sessionRequest('DELETE'))).status, 503, `${mode} DELETE must not revoke hosted sessions`)
    assert.equal(await validateOwnerSession(existingSession, Date.now(), async () => testStore), true, `${mode} must preserve the existing hosted session`)
    const control = await testStore.readHostedControl()
    assert.equal(control.inviteOwners.length, 1)
    assert.equal(control.sessions.length, 1)
    assert.equal(control.requestWindow.globalCount, 0)
  }
})

test('hosted stop switch never exposes the legacy local API to forged localhost headers', async (t) => {
  const keys = [
    'EZAGENT_DEPLOYMENT_MODE', 'EZAGENT_HOSTED_DOCUMENTS_ENABLED', 'EZAGENT_LOCAL_APP_MODE', 'EZAGENT_DOCUMENTS_ENABLED',
  ]
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  t.after(() => { for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  let called = false
  for (const flag of ['0', undefined]) {
    process.env.EZAGENT_DEPLOYMENT_MODE = 'hosted'
    if (flag === undefined) delete process.env.EZAGENT_HOSTED_DOCUMENTS_ENABLED
    else process.env.EZAGENT_HOSTED_DOCUMENTS_ENABLED = flag
    process.env.EZAGENT_LOCAL_APP_MODE = '1'
    process.env.EZAGENT_DOCUMENTS_ENABLED = '1'
    const forgedLocalRequest = new Request('http://localhost:3000/api/documents/orders', {
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    })
    const response = await handleDocumentApi(forgedLocalRequest, async () => { called = true; return { legacyData: true } })
    assert.equal(response.status, 503)
    assert.equal(called, false)
  }
})

test('document JSON reader enforces its byte limit while streaming the request body', async () => {
  const exactBody = `{"x":"${'x'.repeat(MAX_DOCUMENT_REQUEST_BYTES - 8)}"}`
  assert.equal(new TextEncoder().encode(exactBody).byteLength, MAX_DOCUMENT_REQUEST_BYTES)
  assert.deepEqual(await readDocumentJson(new Request('https://demo.example.test/api/documents', { method: 'POST', body: exactBody })), { x: 'x'.repeat(MAX_DOCUMENT_REQUEST_BYTES - 8) })
  const body = JSON.stringify({ content: 'x'.repeat(MAX_DOCUMENT_REQUEST_BYTES) })
  await assert.rejects(readDocumentJson(new Request('https://demo.example.test/api/documents', { method: 'POST', body })),
    (error: unknown) => typeof error === 'object' && error !== null && 'status' in error && (error as { status: number }).status === 413)
})

test('daily suggestion caps persist and roll over only when UTC day advances', async (t) => {
  const store = await tempControlStore(t)
  const hosted = config({ dailySuggestions: 1 })
  const provider = async () => store
  const ownerId = '5f35411a-8527-4af3-8d96-c68177642f53'
  const now = Date.now()
  assert.equal(await withHostedSuggestionSlot(ownerId, hosted, undefined, async () => 'first', provider, () => now), 'first')
  await assert.rejects(withHostedSuggestionSlot(ownerId, hosted, undefined, async () => 'second', provider, () => now),
    (error: unknown) => error instanceof HostedControlError && error.code === 'daily_cap')
  const nextDay = now + 24 * 60 * 60 * 1000
  assert.equal(await withHostedSuggestionSlot(ownerId, hosted, undefined, async () => 'next day', provider, () => nextDay), 'next day')
  assert.equal((await store.readHostedControl()).dailySuggestions.byOwner[ownerId], 1)
})

test('dead timed-out suggestion leases are released after a process restart', async (t) => {
  const store = await tempControlStore(t)
  const hosted = config({ suggestionTimeoutMs: 1000, maxQueue: 0 })
  const provider = async () => store
  const now = Date.now()
  await store.updateHostedControl((control) => {
    control.activeSuggestions.push({ id: '9ef7f599-3a79-497f-924d-5e7227e8cc5b', ownerId: '5f35411a-8527-4af3-8d96-c68177642f53', pid: 2_147_483_647, startedAt: now - 10_000 })
  })
  assert.equal(await withHostedSuggestionSlot('cb58ad85-d45a-4fce-815b-a8be57fc8650', hosted, undefined, async () => 'recovered', provider, () => now), 'recovered')
  assert.equal((await store.readHostedControl()).activeSuggestions.length, 0)
})

test('hosted store selection fails closed when server-derived owner context is missing', async () => {
  await assert.rejects(documentStoreForContext({ hosted: true }),
    (error: unknown) => error instanceof DocumentApiError && error.code === 'hosted_owner_missing')
})

test('signed session cookies are tamper evident, expiring, and secure browser-only cookies', () => {
  const now = Date.now()
  const claims = { ownerId: '5f35411a-8527-4af3-8d96-c68177642f53', nonce: 'cb58ad85-d45a-4fce-815b-a8be57fc8650', expiresAt: now + 5_000 }
  const token = signHostedSession(claims, config().sessionSecret)
  assert.deepEqual(verifyHostedSessionToken(token, config().sessionSecret, now), claims)
  assert.equal(verifyHostedSessionToken(`${token}x`, config().sessionSecret, now), null)
  assert.equal(verifyHostedSessionToken(token, config().sessionSecret, claims.expiresAt), null)
  const cookie = hostedSessionCookie(token, 300)
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Path=\//)
})

test('session login requires an explicit acknowledgement of the current data policy', () => {
  const accepted = { inviteId: 'judge-a', accessToken: 'a'.repeat(40), policyVersion: DOCUMENT_POLICY_VERSION, policyAccepted: true }
  assert.equal(isHostedSessionLogin(accepted, DOCUMENT_POLICY_VERSION), true)
  assert.equal(isHostedSessionLogin({ ...accepted, policyAccepted: false }, DOCUMENT_POLICY_VERSION), false)
  assert.equal(isHostedSessionLogin(accepted, 'older-policy'), false)
  assert.equal(isHostedSessionLogin({ ...accepted, ownerId: 'client-selected' }, DOCUMENT_POLICY_VERSION), false)
})

test('invite reuse resumes one durable owner, rotates its session, and logout revokes only the session', async (t) => {
  const store = await tempControlStore(t)
  const hosted = config()
  const provider = async () => store
  const first = await issueOwnerSession('judge-a', hosted, Date.now(), provider)
  const second = await issueOwnerSession('judge-a', hosted, Date.now() + 1, provider)
  assert.equal(first.ownerId, second.ownerId)
  assert.equal(await validateOwnerSession(first, Date.now() + 2, provider), false)
  assert.equal(await validateOwnerSession(second, Date.now() + 2, provider), true)
  await revokeOwnerSession(second, Date.now() + 3, provider)
  assert.equal(await validateOwnerSession(second, Date.now() + 4, provider), false)
  const resumed = await issueOwnerSession('judge-a', hosted, second.expiresAt + 1, provider)
  assert.equal(resumed.ownerId, second.ownerId)
  assert.equal(await validateOwnerSession(resumed, second.expiresAt + 2, provider), true)
  await assert.rejects(authorizeOwnerSessionAndRecordRequest(second, { ...hosted, invites: [hosted.invites[1]] }, Date.now() + 5, provider),
    (error: unknown) => error instanceof HostedControlError && error.code === 'invalid_session')
  const state = await store.readHostedControl()
  assert.equal(state.inviteOwners.length, 1)
  assert.equal(state.inviteOwners[0].ownerId, first.ownerId)
})

test('owner and request caps persist in the locked control store and reject clock rollback', async (t) => {
  const store = await tempControlStore(t)
  const hosted = config({ maxOwners: 1, requestsPerMinute: 1, globalRequestsPerMinute: 2 })
  const provider = async () => store
  const first = await issueOwnerSession('judge-a', hosted, Date.now(), provider)
  await assert.rejects(issueOwnerSession('judge-b', hosted, Date.now() + 1, provider), (error: unknown) => error instanceof HostedControlError && error.code === 'owner_cap')
  const now = Date.now() + 60_000
  await recordHostedRequest(first.ownerId, hosted, now, provider)
  await assert.rejects(recordHostedRequest(first.ownerId, hosted, now + 1, provider), (error: unknown) => error instanceof HostedControlError && error.code === 'owner_rate_limited')
  await assert.rejects(recordHostedRequest(first.ownerId, hosted, now - 120_000, provider), (error: unknown) => error instanceof HostedControlError && error.code === 'clock_rollback')
})

test('separate owner stores do not share orders, drafts, samples, or clear operations', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ezagent-owner-namespaces-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ownerA = await createDocumentStore(path.join(root, 'owner-a'))
  const ownerB = await createDocumentStore(path.join(root, 'owner-b'))
  assert.equal((await ownerA.listOrders()).length, 0)
  assert.equal((await ownerB.listOrders()).length, 0)
  await ownerA.createOrder({ buyer: { name: 'Synthetic A', address: null, contact: null }, currency: 'HKD', items: [], agreedDate: null, termsText: null, sourceReferenceId: null, sourceReferenceVersion: null })
  assert.equal((await ownerA.listOrders()).length, 1)
  assert.equal((await ownerB.listOrders()).length, 0)
  await ownerA.clearData()
  assert.equal((await ownerA.listOrders()).length, 0)
  assert.equal((await ownerB.listOrders()).length, 0)
})

test('suggestion admission is FIFO, capped, cancellable, and releases the durable active lease', async (t) => {
  const store = await tempControlStore(t)
  const hosted = config({ dailySuggestions: 10, maxQueue: 1, maxQueueWaitMs: 1000 })
  const provider = async () => store
  let finishFirst!: () => void
  let enteredSecond = false
  const first = withHostedSuggestionSlot('5f35411a-8527-4af3-8d96-c68177642f53', hosted, undefined,
    () => new Promise<string>((resolve) => { finishFirst = () => resolve('first') }), provider)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const second = withHostedSuggestionSlot('cb58ad85-d45a-4fce-815b-a8be57fc8650', hosted, undefined,
    async () => { enteredSecond = true; return 'second' }, provider)
  await new Promise((resolve) => setTimeout(resolve, 30))
  await assert.rejects(withHostedSuggestionSlot('9ef7f599-3a79-497f-924d-5e7227e8cc5b', hosted, undefined,
    async () => 'third', provider), (error: unknown) => error instanceof HostedControlError && error.code === 'queue_full')
  assert.equal(enteredSecond, false)
  finishFirst()
  assert.equal(await first, 'first')
  assert.equal(await second, 'second')
  assert.equal(enteredSecond, true)
  const state = await store.readHostedControl()
  assert.equal(state.activeSuggestions.length, 0)
  assert.equal(state.queuedSuggestions.length, 0)
  assert.equal(state.dailySuggestions.byOwner['9ef7f599-3a79-497f-924d-5e7227e8cc5b'], undefined)
})

test('concurrent processes bind the same invite to one owner', async (t) => {
  const store = await tempControlStore(t)
  const root = (store as unknown as { root: string }).root
  const hosted = config()
  const controlModule = path.resolve(__dirname, '../../lib/documents/hosted-control.js')
  const storeModule = path.resolve(__dirname, '../../lib/documents/store.js')
  const child = `
    const { issueOwnerSession } = require(${JSON.stringify(controlModule)});
    const { createDocumentStore } = require(${JSON.stringify(storeModule)});
    const root = process.argv[1], inviteId = process.argv[2], config = JSON.parse(process.argv[3]);
    (async () => { const s = await createDocumentStore(root); const session = await issueOwnerSession(inviteId, config, Date.now(), async () => s); process.stdout.write(session.ownerId); })().catch((e) => { process.stderr.write(e.message); process.exitCode = 1; });
  `
  const run = () => new Promise<string>((resolve, reject) => {
    const proc = spawn(process.execPath, ['-e', child, root, 'judge-a', JSON.stringify(hosted)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; let error = ''
    proc.stdout.on('data', (chunk) => { output += chunk })
    proc.stderr.on('data', (chunk) => { error += chunk })
    proc.on('error', reject)
    proc.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(error || `child exited ${code}`)))
  })
  const owners = await Promise.all([run(), run(), run(), run()])
  assert.equal(new Set(owners).size, 1)
  assert.equal((await store.readHostedControl()).inviteOwners.length, 1)
})

test('control snapshots start with bounded empty admission state', () => {
  const control = emptyHostedControlState(Date.UTC(2026, 9, 15))
  assert.equal(control.inviteOwners.length, 0)
  assert.equal(control.activeSuggestions.length, 0)
  assert.equal(control.dailySuggestions.dayUTC, '2026-10-15')
})
