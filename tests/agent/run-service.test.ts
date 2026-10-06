import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createPlanner } from '../../lib/agent/planner'
import { applyLogicPills } from '../../lib/agent/logic-pills'
import { createAgentRunService, createCancelPostHandler, createResumePostHandler, createRunPostHandler } from '../../lib/agent/run-service'
import { createRunStreamResponse } from '../../lib/agent/run-stream'
import { createAgentStore } from '../../lib/agent/store'
import type { SourceType, WorkflowDefinition } from '../../lib/agent/contracts'

const proposal = {
  workflowType: 'invoice_filter_export',
  steps: [
    'parse_invoice_rows',
    'normalize_invoice_fields',
    'filter_invoice_rows',
    'validate_required_fields',
    'export_csv',
  ],
  requiredFields: ['invoice_id', 'customer', 'amount', 'currency'],
}

async function makeWorkflow(source: { name: string; type: SourceType; content: string }): Promise<WorkflowDefinition> {
  const planner = createPlanner({ fetcher: async () => Response.json({ message: { content: JSON.stringify(proposal) } }) })
  return (await planner.plan({
    goal: 'Find invoices above the threshold, flag missing fields, and export CSV.',
    source,
    parameters: { thresholdMinor: 1_000_000, currency: 'HKD' },
  })).workflow
}

async function waitForTerminal(service: ReturnType<typeof createAgentRunService>, runId: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const run = await service.getRun(runId)
    if (run && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('run did not reach a terminal state')
}

async function waitForNeedsInput(service: ReturnType<typeof createAgentRunService>, runId: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const run = await service.getRun(runId)
    if (run?.status === 'needs_input') return run
    if (run && ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) throw new Error(`run ended as ${run.status}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('run did not request input')
}

test('runs API stores the source immutably, validates every tool step, and commits a CSV artifact once', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-run-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createAgentRunService(root)
  const source = {
    name: 'run-demo.csv',
    type: 'csv' as const,
    content: 'invoice_id,customer,amount,currency,description\nINV-1,=1+1,10000.01,HKD,approved',
  }
  const workflow = await makeWorkflow(source)
  assert.deepEqual(workflow.pills?.map(({ id, value }) => ({ id, value })), [
    { id: 'step:filter:thresholdMinor', value: 1_000_000 },
    { id: 'step:filter:currency', value: 'HKD' },
    { id: 'step:validate:fields', value: ['invoice_id', 'customer', 'amount', 'currency'] },
    { id: 'step:export:columns', value: ['invoice_id', 'customer', 'amount', 'currency', 'description', 'source_file', 'source_row', 'validation_status'] },
  ])
  const handler = createRunPostHandler(service)
  const requestBody = { workflow, source, idempotencyKey: 'run-test-key' }
  assert.equal((await handler(new Request('http://localhost/api/agent/runs', { method: 'POST', body: '{broken' }))).status, 400)
  const invalidWorkflow = { ...workflow, steps: workflow.steps.map((step, index) => index === 0 ? { ...step, tool: 'run_shell' } : step) }
  const rejected = await handler(new Request('http://localhost/api/agent/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, workflow: invalidWorkflow, idempotencyKey: 'invalid-run' }),
  }))
  assert.equal(rejected.status, 400)
  const rejectionBody = await rejected.json()
  assert.equal(rejectionBody.error.code, 'invalid_workflow')
  assert.deepEqual(rejectionBody.error.issues, [
    { path: 'steps[0].tool', code: 'unknown_tool' },
    { path: 'allowedTools', code: 'unused_allowed_tool' },
  ])
  assert.deepEqual(Object.keys(rejectionBody.error).sort(), ['code', 'issues', 'message'])
  assert.equal(JSON.stringify(rejectionBody).includes(source.content), false)

  const response = await handler(new Request('http://localhost/api/agent/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
  }))
  assert.equal(response.status, 202)
  const created = await response.json()
  assert.equal(created.run.status, 'running')

  const completed = await waitForTerminal(service, created.run.id)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.artifacts.length, 1)
  assert.deepEqual(Object.values(completed.taskStates).map((state) => state.status), Array(5).fill('passed'))
  for (const state of Object.values(completed.taskStates)) {
    assert.ok(state.status === 'passed' && state.validation.evidence.length > 0)
  }
  const events = await service.listEvents(completed.id)
  assert.equal(events.events.filter((event) => event.type === 'task_passed').length, 5)
  assert.equal(events.events.at(-1)?.type, 'run_completed')

  const artifact = await service.readArtifact(completed.id, completed.artifacts[0].id)
  assert.ok(artifact)
  const csv = Buffer.from(artifact.contents).toString('utf8')
  assert.match(csv, /"'=1\+1"/)
  assert.match(csv, /"source_file","source_row","validation_status"/)
  assert.equal(completed.artifacts[0].sourceRefs.length, 1)
  assert.ok('rowNumber' in completed.artifacts[0].sourceRefs[0])
  if ('rowNumber' in completed.artifacts[0].sourceRefs[0]) assert.equal(completed.artifacts[0].sourceRefs[0].rowNumber, 2)

  const storedSource = JSON.parse(await readFile(join(root, 'sources', `${completed.id}.json`), 'utf8'))
  assert.deepEqual(storedSource, source)
  assert.equal((await stat(join(root, 'sources', `${completed.id}.json`))).mode & 0o777, 0o600)
  assert.equal((await stat(join(root, 'artifacts', `${completed.artifacts[0].id}.csv`))).mode & 0o777, 0o600)
  const retry = await handler(new Request('http://localhost/api/agent/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
  }))
  assert.equal(retry.status, 200)
  const retriedRun = (await retry.json()).run
  assert.equal(retriedRun.id, completed.id)
  assert.equal(retriedRun.artifacts[0].id, completed.artifacts[0].id)
  assert.equal(Buffer.from((await service.readArtifact(completed.id, completed.artifacts[0].id))!.contents).toString('utf8'), csv)

  const conflict = await handler(new Request('http://localhost/api/agent/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, source: { ...source, content: source.content.replace('10000.01', '20000.01') } }),
  }))
  assert.equal(conflict.status, 409)
})

test('resume API applies bounded filter corrections to working data and preserves the source', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-resume-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createAgentRunService(root)
  const source = { name: 'resume.csv', type: 'csv' as const, content: 'invoice_id,customer,amount,currency\nINV-1,Ada,12000.00,USD\n' }
  const workflow = await makeWorkflow(source)
  const created = await service.createRun({ workflow, source, idempotencyKey: 'resume-correction-key' })
  const waiting = await waitForNeedsInput(service, created.run.id)
  assert.equal(waiting.currentTask, 'filter')
  assert.deepEqual(Object.values(waiting.taskStates).slice(0, 2).map(({ status }) => status), ['passed', 'passed'])
  const handler = createResumePostHandler(service)
  const post = (input: unknown) => handler(new Request(`http://localhost/api/agent/runs/${waiting.id}/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }),
  }), waiting.id)
  assert.equal((await post({ taskId: 'other', corrections: [{ field: 'currency', value: 'USD' }] })).status, 400)
  assert.equal((await post({ taskId: 'filter', corrections: [{ field: 'source', value: 'changed' }] })).status, 400)
  assert.equal((await post({ taskId: 'filter', corrections: [{ field: 'currency', value: 'EUR' }] })).status, 400)
  assert.equal((await post({ taskId: 'filter', corrections: [{ field: 'thresholdMinor', value: '-1' }] })).status, 400)
  assert.equal((await post({ taskId: 'filter', corrections: [{ field: 'currency', value: 'USD' }] })).status, 200)
  const completed = await waitForTerminal(service, waiting.id)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.workflowVersion, 2)
  assert.equal(completed.workflow.parameters.currency, 'USD')
  assert.deepEqual(Object.values(completed.taskStates).map(({ status }) => status), Array(5).fill('passed'))
  assert.deepEqual(JSON.parse(await readFile(join(root, 'sources', `${waiting.id}.json`), 'utf8')), source)
  const events = (await service.listEvents(waiting.id)).events
  assert.ok(events.some((event) => event.type === 'workflow_corrected' && JSON.stringify(event.payload).includes('currency')))
  assert.equal(events.filter((event) => event.type === 'needs_input').length, 1)
})

test('Planner-edited pills pass the Run API while bound-pill tampering fails closed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-pill-run-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createAgentRunService(root)
  const handler = createRunPostHandler(service)
  const source = { name: 'pill-run.csv', type: 'csv' as const, content: 'invoice_id,customer,amount,currency\nINV-PILL,Ada,12000.00,HKD\n' }
  const proposal = await makeWorkflow(source)
  const pills = proposal.pills!.map((pill) => {
    if (pill.id === 'step:filter:thresholdMinor') return { ...pill, value: 999_999 }
    if (pill.id === 'step:validate:fields') return { ...pill, value: [...(pill.value as string[]).filter((field) => field !== 'customer'), 'customer'] }
    return pill
  })
  pills.push({ id: 'custom:review-note', label: 'Review note', type: 'text', value: 'Synthetic test' })
  const edited = applyLogicPills(proposal, pills)
  assert.deepEqual(edited.errors, [])
  const accepted = await handler(new Request('http://localhost/api/agent/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow: edited.workflow, source, idempotencyKey: 'pill-run-positive' }),
  }))
  assert.equal(accepted.status, 202)
  const acceptedRun = (await accepted.json()).run
  const completed = await waitForTerminal(service, acceptedRun.id)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.workflow.parameters.thresholdMinor, 999_999)
  assert.deepEqual(completed.workflow.steps[3].parameters?.fields, ['invoice_id', 'customer', 'amount', 'currency'])
  assert.deepEqual(completed.workflow.allowedTools, proposal.allowedTools)
  assert.ok(completed.workflow.pills?.some((pill) => pill.id === 'custom:review-note'))

  const tampered = {
    ...edited.workflow,
    pills: edited.workflow.pills!.map((pill) => pill.id === 'step:filter:currency' ? { ...pill, value: 'USD' } : pill),
  }
  const rejected = await handler(new Request('http://localhost/api/agent/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow: tampered, source, idempotencyKey: 'pill-run-negative' }),
  }))
  assert.equal(rejected.status, 400)
  assert.equal((await rejected.json()).error.code, 'invalid_workflow')
})

test('retryable filter corrections stop at the finite task attempt limit', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-retry-limit-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createAgentRunService(root)
  const source = { name: 'small.csv', type: 'csv' as const, content: 'invoice_id,customer,amount,currency\nINV-1,Ada,100.00,HKD\n' }
  const workflow = await makeWorkflow(source)
  const created = await service.createRun({ workflow, source, idempotencyKey: 'retry-limit-key' })
  let waiting = await waitForNeedsInput(service, created.run.id)
  assert.equal(waiting.taskStates.filter.status, 'needs_input')
  for (let attempt = 2; attempt <= waiting.limits.maxAttemptsPerTask; attempt += 1) {
    await service.resumeRun(waiting.id, { taskId: 'filter', corrections: [{ field: 'thresholdMinor', value: String(2_000_000 + attempt) }] })
    const result = await waitForTerminalOrInput(service, waiting.id)
    if (attempt === waiting.limits.maxAttemptsPerTask) {
      assert.equal(result.status, 'failed')
      assert.equal(result.taskStates.filter.status, 'failed')
      assert.equal(result.taskStates.filter.attempts, waiting.limits.maxAttemptsPerTask)
    } else {
      assert.equal(result.status, 'needs_input')
      waiting = result
    }
  }
})

test('empty resume after interruption keeps passed tasks and safely restarts the current task', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-interrupted-resume-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createAgentRunService(root)
  const source = { name: 'interrupted.csv', type: 'csv' as const, content: 'invoice_id,customer,amount,currency\nINV-1,Ada,100.00,HKD\n' }
  const workflow = await makeWorkflow(source)
  const created = await service.createRun({ workflow, source, idempotencyKey: 'interrupted-resume-key' })
  const waiting = await waitForNeedsInput(service, created.run.id)
  const store = await createAgentStore(root)
  const interrupted = await store.getRun(waiting.id)
  assert.ok(interrupted)
  interrupted.status = 'interrupted'
  await store.saveRun(interrupted)
  const handler = createResumePostHandler(service)
  const response = await handler(new Request(`http://localhost/api/agent/runs/${waiting.id}/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }), waiting.id)
  assert.equal(response.status, 200)
  const resumed = await waitForNeedsInput(service, waiting.id)
  assert.equal(resumed.status, 'needs_input')
  assert.equal(resumed.taskStates.parse.status, 'passed')
  assert.equal(resumed.taskStates.normalize.status, 'passed')
  assert.equal(resumed.taskStates.parse.attempts, 1)
  assert.equal(resumed.taskStates.filter.attempts, 2)
  assert.equal(resumed.artifacts.length, 0)
})

test('cancel endpoint transition stops a needs_input run and prevents later work', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ezagent-cancel-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const service = createAgentRunService(root)
  const source = { name: 'cancel.csv', type: 'csv' as const, content: 'invoice_id,customer,amount,currency\nINV-1,Ada,100.00,HKD\n' }
  const workflow = await makeWorkflow(source)
  const created = await service.createRun({ workflow, source, idempotencyKey: 'cancel-needs-input-key' })
  const waiting = await waitForNeedsInput(service, created.run.id)
  const cancelResponse = await createCancelPostHandler(service)(new Request(`http://localhost/api/agent/runs/${waiting.id}/cancel`, { method: 'POST' }), waiting.id)
  assert.equal(cancelResponse.status, 200)
  const cancelled = (await cancelResponse.json()).run
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.currentTask, null)
  assert.equal(cancelled.artifacts.length, 0)
  await assert.rejects(service.resumeRun(waiting.id, { taskId: 'filter', corrections: [{ field: 'currency', value: 'HKD' }] }), { code: 'run_not_resumable' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const final = await service.getRun(waiting.id)
  assert.equal(final?.status, 'cancelled')
  assert.equal(final?.artifacts.length, 0)
  const events = (await service.listEvents(waiting.id)).events
  assert.equal(events.filter((event) => event.type === 'run_cancelled').length, 1)
  assert.equal(events.some((event) => event.type === 'run_completed'), false)
})

async function waitForTerminalOrInput(service: ReturnType<typeof createAgentRunService>, runId: string) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const run = await service.getRun(runId)
    if (run && ['needs_input', 'completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('run did not reach an input or terminal state')
}

test('SSE stream emits heartbeat frames while a run waits for input', async () => {
  const fakeService = {
    listEvents: async () => ({ events: [], nextSequence: 0 }),
    getRun: async () => ({ status: 'needs_input' }),
  } as unknown as ReturnType<typeof createAgentRunService>
  const response = createRunStreamResponse(new Request('http://localhost/stream'), 'stream-test', 0, fakeService, 2, 5)
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  const reader = response.body!.getReader()
  let chunk = ''
  const deadline = Date.now() + 1_000
  while (!chunk.includes(': heartbeat') && Date.now() < deadline) {
    const value = await reader.read()
    chunk += new TextDecoder().decode(value.value)
  }
  assert.match(chunk, /: heartbeat\n\n/)
  await reader.cancel()
})
