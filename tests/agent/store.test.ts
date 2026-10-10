import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DEFAULT_RUN_LIMITS, type Artifact, type Run, type RunStatus } from '../../lib/agent/contracts'
import { AgentStoreError, createAgentStore } from '../../lib/agent/store'

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function createRun(status: RunStatus = 'draft', artifacts: Artifact[] = []): Run {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    workflowVersion: 1,
    status,
    limits: { ...DEFAULT_RUN_LIMITS },
    currentTask: null,
    createdAt: now,
    updatedAt: now,
    workflow: {
      version: 1,
      goal: 'Store test workflow',
      steps: [{ id: 'parse', dependencies: [], tool: 'parse_invoice_rows', inputRefs: ['source'], acceptance: [] }],
      parameters: {},
      allowedTools: ['parse_invoice_rows'],
      acceptance: [],
    },
    taskStates: { parse: { status: 'pending', attempts: 0 } },
    artifacts,
  }
}

async function makeRoot(t: { after(callback: () => void | Promise<void>): void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-store-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function assertStoreError(error: unknown, code: string): boolean {
  return error instanceof AgentStoreError && error.code === code
}

test('createAgentStore initializes an atomic version 1 snapshot', async (t) => {
  const root = await makeRoot(t)
  await createAgentStore(root)
  const snapshot = JSON.parse(await readFile(join(root, 'snapshot.json'), 'utf8'))
  assert.equal(snapshot.version, 1)
  assert.deepEqual(snapshot.runs, [])
  assert.deepEqual(snapshot.idempotency, {})
  assert.deepEqual(snapshot.events, {})
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])
})

test('idempotency retries return the same run and reject a different payload', async (t) => {
  const store = await createAgentStore(await makeRoot(t))
  const run = createRun()
  const created = await store.createRun({ idempotencyKey: 'request-key', payloadFingerprint: fingerprint('payload-a'), run })
  const retried = await store.createRun({ idempotencyKey: 'request-key', payloadFingerprint: fingerprint('payload-a'), run: createRun() })

  assert.equal(created.created, true)
  assert.equal((await store.findRunByIdempotencyKey('request-key', fingerprint('payload-a')))?.id, run.id)
  assert.equal(retried.created, false)
  assert.equal(retried.run.id, run.id)
  await assert.rejects(
    store.createRun({ idempotencyKey: 'request-key', payloadFingerprint: fingerprint('payload-b'), run: createRun() }),
    (error) => assertStoreError(error, 'idempotency_conflict'),
  )
  await assert.rejects(
    store.findRunByIdempotencyKey('request-key', fingerprint('payload-b')),
    (error) => assertStoreError(error, 'idempotency_conflict'),
  )
})

test('concurrent event appends receive strictly increasing per-run sequence numbers', async (t) => {
  const root = await makeRoot(t)
  const store = await createAgentStore(root)
  const secondStoreInstance = await createAgentStore(root)
  const run = createRun()
  await store.createRun({ idempotencyKey: 'events-key', payloadFingerprint: fingerprint('events'), run })
  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    (index % 2 === 0 ? store : secondStoreInstance).appendEvent({
      runId: run.id, type: 'test_event', payload: { ordinal: index },
    }),
  ))

  const page = await store.listEvents(run.id)
  assert.deepEqual(page.events.map((event) => event.sequence), Array.from({ length: 12 }, (_, index) => index + 1))
  assert.equal(page.nextSequence, 12)
  assert.equal((await store.listEvents(run.id, 7)).events.length, 5)
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])
})

test('creating another store instance in the same process does not interrupt a live run', async (t) => {
  const root = await makeRoot(t)
  const store = await createAgentStore(root)
  const run = createRun('running')
  await store.createRun({ idempotencyKey: 'active-key', payloadFingerprint: fingerprint('active'), run })

  const secondStoreInstance = await createAgentStore(root)
  assert.equal((await secondStoreInstance.getRun(run.id))?.status, 'running')
})

test('a fresh process marks running and cancelling runs interrupted without losing artifacts or sequence', async (t) => {
  const root = await makeRoot(t)
  const store = await createAgentStore(root)
  const artifact: Artifact = {
    id: 'artifact-1',
    type: 'csv',
    location: 'runs/server-generated/artifact-1.csv',
    sourceRefs: [{ fileName: 'invoices.csv', rowNumber: 2 }],
    validation: { pass: true, code: 'accepted', evidence: ['row 2 validated'], retryable: false },
  }
  const running = createRun('running', [artifact])
  const cancelling = createRun('cancelling')
  await store.createRun({ idempotencyKey: 'running-key', payloadFingerprint: fingerprint('running'), run: running })
  await store.createRun({ idempotencyKey: 'cancelling-key', payloadFingerprint: fingerprint('cancelling'), run: cancelling })
  await store.appendEvent({ runId: running.id, type: 'task_started', payload: { taskId: 'parse' } })

  const recoveryScript = [
    "const { createAgentStore } = require(process.argv[1]);",
    '(async () => {',
    '  const store = await createAgentStore(process.argv[2]);',
    '  const running = await store.getRun(process.argv[3]);',
    '  const cancelling = await store.getRun(process.argv[4]);',
    '  const events = await store.listEvents(process.argv[3]);',
    '  process.stdout.write(JSON.stringify({ runningStatus: running?.status, cancellingStatus: cancelling?.status, artifactIds: running?.artifacts.map((item) => item.id), events: events.events.map(({ sequence, type }) => ({ sequence, type })) }));',
    '})().catch(() => { process.stderr.write("store recovery failed"); process.exitCode = 1; });',
  ].join('\n')
  const child = spawnSync(process.execPath, [
    '-e', recoveryScript,
    require.resolve('../../lib/agent/store'),
    root,
    running.id,
    cancelling.id,
  ], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(child.status, 0, 'fresh process recovery failed')
  const recovery = JSON.parse(child.stdout) as {
    runningStatus: string
    cancellingStatus: string
    artifactIds: string[]
    events: Array<{ sequence: number; type: string }>
  }
  assert.equal(recovery.runningStatus, 'interrupted')
  assert.equal(recovery.cancellingStatus, 'interrupted')
  assert.deepEqual(recovery.artifactIds, [artifact.id])
  assert.deepEqual(recovery.events, [
    { sequence: 1, type: 'task_started' },
    { sequence: 2, type: 'run_interrupted' },
  ])

  const resumedRun = await store.getRun(running.id)
  assert.equal(resumedRun?.status, 'interrupted')
  const saved = await store.saveRun({ ...resumedRun!, artifacts: [] })
  assert.deepEqual(saved.artifacts, [artifact])
  await assert.rejects(
    store.saveRun({ ...saved, artifacts: [{ ...artifact, location: 'replacement.csv' }] }),
    (error) => assertStoreError(error, 'artifact_conflict'),
  )

  const interruptionEvents = await store.listEvents(running.id)
  assert.deepEqual(interruptionEvents.events.map((event) => event.sequence), [1, 2])
  assert.equal(interruptionEvents.events[1].type, 'run_interrupted')
})

test('corrupt snapshots fail closed and remain byte-for-byte unchanged', async (t) => {
  const root = await makeRoot(t)
  const snapshotPath = join(root, 'snapshot.json')
  const original = '{broken-snapshot'
  await writeFile(snapshotPath, original, 'utf8')

  await assert.rejects(createAgentStore(root), (error) => assertStoreError(error, 'corrupt_snapshot'))
  assert.equal(await readFile(snapshotPath, 'utf8'), original)
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.tmp')), [])
})
