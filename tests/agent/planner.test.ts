import { applyLogicPills, deriveLogicPills } from '../../lib/agent/logic-pills'
import { validateWorkflowForRun } from '../../lib/agent/planner'
import assert from 'node:assert/strict'
import test from 'node:test'

import { POST } from '../../app/api/agent/plans/route'
import { createPlanPostHandler, createPlanner, PlannerError, validatePlanRequest } from '../../lib/agent/planner'

const requestBody = {
  goal: 'Find invoices above the threshold, flag missing fields, and export CSV.',
  source: {
    name: 'invoices.csv',
    type: 'csv',
    content: 'invoice_id,customer,amount,currency,description\nINV-1,CantoNet,1200000,HKD,Design retainer',
  },
  parameters: { thresholdMinor: 1_000_000, currency: 'HKD' },
}

function compactProposal() {
  return {
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
}

function ollamaReply(content: string, status = 200): Response {
  return Response.json({ message: { content } }, { status })
}

function plannerErrorCode(error: unknown): string | undefined {
  return error instanceof PlannerError ? error.code : undefined
}

test('planner returns a validated five-step proposal and sends metadata, not source content', async () => {
  let capturedBody: Record<string, unknown> | undefined
  const planner = createPlanner({
    fetcher: async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return ollamaReply(JSON.stringify(compactProposal()))
    },
  })

  const result = await planner.plan(requestBody)
  assert.equal(result.workflow.steps.length, 5)
  assert.equal(result.preview.source.rowCount, 2)
  assert.equal(result.preview.currency, 'HKD')
  assert.deepEqual(result.workflow.steps[3].parameters?.fields, ['invoice_id', 'customer', 'amount', 'currency'])
  assert.deepEqual(result.workflow.steps[4].parameters?.columns, ['invoice_id', 'customer', 'amount', 'currency', 'description', 'source_file', 'source_row', 'validation_status'])
  assert.equal(capturedBody?.model, 'qwen3.5:9b')
  assert.deepEqual(capturedBody?.stream, false)
  assert.deepEqual(capturedBody?.think, false)
  assert.deepEqual((capturedBody?.options as { num_predict: number }).num_predict, 256)
  const serializedMessages = JSON.stringify(capturedBody?.messages)
  assert.equal(serializedMessages.includes(requestBody.source.content), false)
  assert.equal(serializedMessages.includes('invoices.csv'), true)
  assert.equal(typeof capturedBody?.format, 'object')
})

test('planner repairs one invalid proposal and accepts the corrected proposal', async () => {
  let calls = 0
  const invalid = { ...compactProposal(), steps: ['parse_invoice_rows', 'normalize_invoice_fields', 'run_shell', 'validate_required_fields', 'export_csv'] }
  const planner = createPlanner({
    fetcher: async () => {
      calls += 1
      return ollamaReply(JSON.stringify(calls === 1 ? invalid : compactProposal()))
    },
  })

  const result = await planner.plan(requestBody)
  assert.equal(calls, 2)
  assert.equal(result.workflow.steps[2].tool, 'filter_invoice_rows')
})

test('planner rejects unknown tools, dependency cycles, and path injection after one correction attempt', async () => {
  const unknownTool = { ...compactProposal(), steps: ['parse_invoice_rows', 'run_shell', 'filter_invoice_rows', 'validate_required_fields', 'export_csv'] }
  const cyclic = { ...compactProposal(), steps: [{ tool: 'parse_invoice_rows', dependencies: ['parse'] }, ...compactProposal().steps.slice(1)] }
  const pathInjection = { ...compactProposal(), sourcePath: '../../private.csv' }

  for (const invalidProposal of [unknownTool, cyclic, pathInjection]) {
    let calls = 0
    const planner = createPlanner({
      fetcher: async () => {
        calls += 1
        return ollamaReply(JSON.stringify(invalidProposal))
      },
    })
    await assert.rejects(planner.plan(requestBody), (error) => plannerErrorCode(error) === 'invalid_proposal')
    assert.equal(calls, 2)
  }
})

test('deterministic compiler pins request filter and model-selected fields into the workflow', async () => {
  const planner = createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(compactProposal())) })
  const result = await planner.plan(requestBody)
  assert.deepEqual(result.workflow.steps[2].parameters, { thresholdMinor: 1_000_000, currency: 'HKD' })
  assert.deepEqual(result.workflow.steps[3].parameters, { fields: ['invoice_id', 'customer', 'amount', 'currency'] })
  assert.deepEqual(result.workflow.acceptance.map(({ type }) => type), [
    'required_fields', 'currency_exact', 'minimum_amount_minor', 'csv_formula_safe',
  ])
  assert.equal((result.workflow.acceptance[0] as { fields: string[] }).fields.includes('description'), false)
})

test('different legal model field proposals produce different validated workflows', async () => {
  const descriptionGoal = { ...requestBody, goal: 'Find invoices above the threshold, flag missing description fields, and export CSV.' }
  const base = compactProposal()
  const withDescription = { ...base, requiredFields: ['invoice_id', 'customer', 'amount', 'currency', 'description'] }
  const plannerFor = (proposal: unknown) => createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(proposal)) })
  const a = await plannerFor(base).plan(descriptionGoal)
  const b = await plannerFor(withDescription).plan(descriptionGoal)
  assert.notDeepEqual(a.workflow.steps[3].parameters, b.workflow.steps[3].parameters)
  assert.notDeepEqual(a.workflow.acceptance[0], b.workflow.acceptance[0])
  assert.deepEqual(b.workflow.steps[3].parameters, { fields: withDescription.requiredFields })
})

test('planner rejects path-like file names and unknown request fields without contacting Ollama', async () => {
  let calls = 0
  const planner = createPlanner({ fetcher: async () => { calls += 1; return ollamaReply('{}') } })
  assert.equal(validatePlanRequest({ ...requestBody, source: { ...requestBody.source, name: '../invoices.csv' } }).ok, false)
  assert.equal(validatePlanRequest({ ...requestBody, debug: true }).ok, false)
  await assert.rejects(planner.plan({ ...requestBody, source: { ...requestBody.source, name: 'C:\\private.csv' } }), (error) => plannerErrorCode(error) === 'invalid_request')
  assert.equal(calls, 0)
})

test('planner rejects unsupported goals and schemas before Ollama and accepts the Chinese demo goal', async () => {
  let calls = 0
  const planner = createPlanner({ fetcher: async () => { calls += 1; return ollamaReply(JSON.stringify(compactProposal())) } })
  await assert.rejects(planner.plan({ ...requestBody, goal: 'Write a poem about the sea.' }), (error) => plannerErrorCode(error) === 'invalid_request')
  await assert.rejects(planner.plan({ ...requestBody, source: { ...requestBody.source, content: 'invoice_id,customer,currency\nINV-1,CantoNet,HKD' } }), (error) => plannerErrorCode(error) === 'invalid_request')
  await assert.rejects(planner.plan({ ...requestBody, source: { ...requestBody.source, content: 'invoice_id,amount,currency,secret\nINV-1,1200000,HKD,x' } }), (error) => plannerErrorCode(error) === 'invalid_request')
  const chineseGoal = { ...requestBody, goal: '找出金額超過 HKD 10,000 的發票項目，標記必要欄位缺漏，並匯出 CSV。' }
  assert.equal(validatePlanRequest(chineseGoal).ok, true)
  await planner.plan(chineseGoal)
  assert.equal(calls, 1)
})

test('planner and plans route accept bounded plain-text invoice rows without sending their contents to Ollama', async () => {
  const textBody = {
    ...requestBody,
    source: {
      name: 'invoices.txt',
      type: 'text',
      content: 'invoice_id|customer|amount|currency|description\nINV-1|CantoNet|1200000|HKD|Design retainer',
    },
  }
  const validated = validatePlanRequest(textBody)
  assert.equal(validated.ok, true)
  if (validated.ok) {
    assert.deepEqual(validated.value.sourceSchema.headers, ['invoice_id', 'customer', 'amount', 'currency', 'description'])
    assert.equal(validated.value.sourceSchema.rowCount, 2)
  }

  let serializedMessages = ''
  const handler = createPlanPostHandler(createPlanner({
    fetcher: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: unknown }
      serializedMessages = JSON.stringify(body.messages)
      return ollamaReply(JSON.stringify(compactProposal()))
    },
  }).plan)
  const response = await handler(new Request('http://localhost/api/agent/plans', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(textBody),
  }))
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.preview.source.type, 'text')
  assert.equal(result.preview.source.rowCount, 2)
  assert.equal(serializedMessages.includes(textBody.source.content), false)
})

test('planner accepts irregular data rows for runner flagging and enforces plain-text limits', () => {
  const malformed = {
    ...requestBody,
    source: { name: 'broken.txt', type: 'text', content: 'invoice_id|amount|currency\nINV-1|1200000' },
  }
  assert.equal(validatePlanRequest(malformed).ok, true)
  const tooManyRows = [
    'invoice_id|amount|currency',
    ...Array.from({ length: 5_000 }, (_, index) => `INV-${index}|1200000|HKD`),
  ].join('\n')
  assert.equal(validatePlanRequest({ ...malformed, source: { name: 'large.txt', type: 'text', content: tooManyRows } }).ok, false)
  const oversized = { ...malformed, source: { name: 'oversized.txt', type: 'text', content: `invoice_id|amount|currency\n${'x'.repeat(1_048_576)}` } }
  assert.equal(validatePlanRequest(oversized).ok, false)
})

test('planner rejects source over 1 MiB and input with over 5000 rows', () => {
  assert.equal(validatePlanRequest({ ...requestBody, source: { ...requestBody.source, content: 'x'.repeat(1_048_577) } }).ok, false)
  const tooManyRows = Array.from({ length: 5_001 }, () => 'row').join('\n')
  assert.equal(validatePlanRequest({ ...requestBody, source: { ...requestBody.source, type: 'text', content: tooManyRows } }).ok, false)
})

test('planner reports timeout and local Ollama connection failures explicitly', async () => {
  const timeoutPlanner = createPlanner({
    timeoutMs: 1,
    fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }),
  })
  await assert.rejects(timeoutPlanner.plan(requestBody), (error) => plannerErrorCode(error) === 'planner_timeout')

  const unavailablePlanner = createPlanner({ fetcher: async () => { throw new TypeError('socket error with private details') } })
  await assert.rejects(unavailablePlanner.plan(requestBody), (error) => {
    assert.equal(plannerErrorCode(error), 'ollama_unavailable')
    assert.equal((error as Error).message.includes('private details'), false)
    return true
  })
})

test('planner maps Ollama missing-model 404 to model_missing without exposing response details', async () => {
  const planner = createPlanner({ fetcher: async () => Response.json({ error: 'model qwen3.5:9b not found: private detail' }, { status: 404 }) })
  await assert.rejects(planner.plan(requestBody), (error) => {
    assert.equal(plannerErrorCode(error), 'model_missing')
    assert.equal((error as Error).message.includes('private detail'), false)
    return true
  })
})

test('only one planner request may be active per process', async () => {
  let signalStarted!: () => void
  let resolveFetch!: (response: Response) => void
  const started = new Promise<void>((resolve) => { signalStarted = resolve })
  const pendingResponse = new Promise<Response>((resolve) => { resolveFetch = resolve })
  const firstPlanner = createPlanner({ fetcher: async () => { signalStarted(); return pendingResponse } })
  const firstRequest = firstPlanner.plan(requestBody)
  await started

  const secondPlanner = createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(compactProposal())) })
  await assert.rejects(secondPlanner.plan(requestBody), (error) => plannerErrorCode(error) === 'model_busy')
  resolveFetch(ollamaReply(JSON.stringify(compactProposal())))
  await firstRequest
})

test('plans route returns the HTTP contract and generic JSON errors', async () => {
  const plan = { workflow: compactProposal(), preview: { stepCount: 5 } }
  const handler = createPlanPostHandler(async () => plan as never)
  const response = await handler(new Request('http://localhost/api/agent/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), plan)

  const badJson = await handler(new Request('http://localhost/api/agent/plans', { method: 'POST', body: '{bad' }))
  assert.equal(badJson.status, 400)
  assert.deepEqual(await badJson.json(), { error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } })

  const rejectedPath = await POST(new Request('http://localhost/api/agent/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, source: { ...requestBody.source, name: '../private.csv' } }),
  }))
  assert.equal(rejectedPath.status, 400)
  assert.deepEqual(await rejectedPath.json(), { error: { code: 'invalid_request', message: 'Plan request failed input validation.' } })

  const missingModelHandler = createPlanPostHandler(createPlanner({
    fetcher: async () => Response.json({ error: 'model qwen3.5:9b not found' }, { status: 404 }),
  }).plan)
  const missingModel = await missingModelHandler(new Request('http://localhost/api/agent/plans', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
  }))
  assert.equal(missingModel.status, 409)
  assert.deepEqual(await missingModel.json(), { error: { code: 'model_missing', message: 'Required local model qwen3.5:9b is not installed.' } })
})


test('planner pills can be edited and submitted through the real Run validator', async () => {
  const planner = createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(compactProposal())) })
  const plan = await planner.plan(requestBody)
  assert.deepEqual(plan.workflow.pills, deriveLogicPills(plan.workflow))
  const pills = plan.workflow.pills!.map(pill => pill.id.endsWith(':thresholdMinor') ? { ...pill, value: 2_000_000 } : pill)
  pills.push({ id: 'custom:note', label: 'Review note', type: 'text', value: 'Synthetic data' })
  const edited = applyLogicPills(plan.workflow, pills)
  assert.deepEqual(edited.errors, [])
  const validated = validateWorkflowForRun(edited.workflow, requestBody.source as { name: string; type: 'csv'; content: string })
  assert.equal(validated.ok, true, JSON.stringify(validated))
  if (validated.ok) assert.deepEqual(validated.value.pills, pills)
})

test('required-field pill edits keep acceptance, export columns, and stored pill values aligned', async () => {
  const request = { ...requestBody, goal: 'Find invoices above the threshold, check description, flag missing fields, and export CSV.' }
  const planner = createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(compactProposal())) })
  const plan = await planner.plan(request)
  const pills = plan.workflow.pills!.map((pill) => pill.id === 'step:validate:fields'
    ? { ...pill, value: [...pill.value as string[], 'description'] }
    : pill)
  const edited = applyLogicPills(plan.workflow, pills)
  assert.deepEqual(edited.errors, [])
  assert.deepEqual(edited.workflow.steps[3].parameters?.fields, ['invoice_id', 'customer', 'amount', 'currency', 'description'])
  assert.deepEqual(edited.workflow.acceptance.find((criterion) => criterion.type === 'required_fields')?.fields, edited.workflow.steps[3].parameters?.fields)
  assert.deepEqual(edited.workflow.steps[3].acceptance[0], { id: 'required-fields', type: 'required_fields', fields: edited.workflow.steps[3].parameters?.fields })
  assert.deepEqual(edited.workflow.steps[4].parameters?.columns, ['invoice_id', 'customer', 'amount', 'currency', 'description', 'source_file', 'source_row', 'validation_status'])
  assert.deepEqual(edited.workflow.pills?.find((pill) => pill.id === 'step:export:columns')?.value, edited.workflow.steps[4].parameters?.columns)
  const validated = validateWorkflowForRun(edited.workflow, request.source as { name: string; type: 'csv'; content: string })
  assert.equal(validated.ok, true, JSON.stringify(validated))
})

test('removing and re-adding customer tags restores canonical field order before Run validation', async () => {
  const planner = createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(compactProposal())) })
  const plan = await planner.plan(requestBody)
  const changedOrder = plan.workflow.pills!.map((pill) => pill.id === 'step:validate:fields'
    ? { ...pill, value: [...(pill.value as string[]).filter((field) => field !== 'customer'), 'customer'] }
    : pill)
  const edited = applyLogicPills(plan.workflow, changedOrder)

  assert.deepEqual(edited.errors, [])
  assert.deepEqual(edited.workflow.steps[3].parameters?.fields, ['invoice_id', 'customer', 'amount', 'currency'])
  assert.deepEqual(edited.workflow.pills?.find((pill) => pill.id === 'step:validate:fields')?.value, ['invoice_id', 'customer', 'amount', 'currency'])
  assert.deepEqual(edited.workflow.acceptance.find((criterion) => criterion.type === 'required_fields')?.fields, ['invoice_id', 'customer', 'amount', 'currency'])
  assert.equal(validateWorkflowForRun(edited.workflow, requestBody.source as { name: string; type: 'csv'; content: string }).ok, true)
})

test('optional description column can be removed and re-added in canonical order before a Run', async () => {
  const planner = createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(compactProposal())) })
  const plan = await planner.plan(requestBody)
  const withoutDescriptionPills = plan.workflow.pills!.map((pill) => pill.id === 'step:export:columns'
    ? { ...pill, value: (pill.value as string[]).filter((column) => column !== 'description') }
    : pill)
  const removed = applyLogicPills(plan.workflow, withoutDescriptionPills)
  assert.deepEqual(removed.errors, [])
  assert.deepEqual(removed.workflow.steps[4].parameters?.columns, ['invoice_id', 'customer', 'amount', 'currency', 'source_file', 'source_row', 'validation_status'])
  assert.equal(validateWorkflowForRun(removed.workflow, requestBody.source as { name: string; type: 'csv'; content: string }).ok, true)

  const withDescriptionAppended = removed.workflow.pills!.map((pill) => pill.id === 'step:export:columns'
    ? { ...pill, value: [...pill.value as string[], 'description'] }
    : pill)
  const readded = applyLogicPills(removed.workflow, withDescriptionAppended)
  assert.deepEqual(readded.errors, [])
  assert.deepEqual(readded.workflow.steps[4].parameters?.columns, ['invoice_id', 'customer', 'amount', 'currency', 'description', 'source_file', 'source_row', 'validation_status'])
  assert.deepEqual(readded.workflow.pills?.find((pill) => pill.id === 'step:export:columns')?.value, readded.workflow.steps[4].parameters?.columns)
  assert.equal(validateWorkflowForRun(readded.workflow, requestBody.source as { name: string; type: 'csv'; content: string }).ok, true)
})

test('Run validator rejects bound pill drift while retaining legacy workflows without pills', async () => {
  const planner = createPlanner({ fetcher: async () => ollamaReply(JSON.stringify(compactProposal())) })
  const plan = await planner.plan(requestBody)
  const mismatched = {
    ...plan.workflow,
    pills: plan.workflow.pills!.map((pill) => pill.id === 'step:filter:currency' ? { ...pill, value: 'USD' } : pill),
  }
  const rejected = validateWorkflowForRun(mismatched, requestBody.source as { name: string; type: 'csv'; content: string })
  assert.equal(rejected.ok, false)
  if (!rejected.ok) assert.ok(rejected.issues.some((issue) => issue.code === 'pill_workflow_mismatch'))

  const { pills: _pills, ...legacyWorkflow } = plan.workflow
  assert.equal(validateWorkflowForRun(legacyWorkflow, requestBody.source as { name: string; type: 'csv'; content: string }).ok, true)
})
