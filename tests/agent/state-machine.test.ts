import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_RUN_LIMITS, type TaskState } from '../../lib/agent/contracts'
import { transitionRun, transitionTask } from '../../lib/agent/state-machine'
import * as stateMachine from '../../lib/agent/state-machine'
import { validateRunLimits, validateWorkflow } from '../../lib/agent/validation'

test('state-only transition helpers are not exported', () => {
  assert.equal('isAllowedTaskTransition' in stateMachine, false)
  assert.equal('isAllowedRunTransition' in stateMachine, false)
})

test('pending task cannot pass without running and validating', () => {
  const result = transitionTask({ status: 'pending', attempts: 0 }, 'pass')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.issues[0].code, 'illegal_task_transition')
})

test('run transitions require approval and do not reopen terminal runs', () => {
  assert.equal(transitionRun('draft', 'running').ok, false)
  assert.deepEqual(transitionRun('draft', 'awaiting_approval'), { ok: true, value: 'awaiting_approval' })
  assert.deepEqual(transitionRun('awaiting_approval', 'running'), { ok: true, value: 'running' })
  assert.equal(transitionRun('completed', 'running').ok, false)
})

test('a run completes only when every task has passed', () => {
  assert.equal(transitionRun('running', 'completed').ok, false)
  assert.equal(transitionRun('running', 'completed', { taskA: { status: 'pending', attempts: 0 } }).ok, false)
  assert.equal(transitionRun('running', 'completed', { taskA: { status: 'failed', attempts: 1 } }).ok, false)
  assert.deepEqual(
    transitionRun('running', 'completed', {
      taskA: { status: 'passed', attempts: 1, validation: { pass: true, code: 'ok', evidence: ['row 2 validated'], retryable: false } },
      taskB: { status: 'passed', attempts: 1, validation: { pass: true, code: 'ok', evidence: ['CSV export validated'], retryable: false } },
    }),
    { ok: true, value: 'completed' },
  )
})

test('a passed task needs successful non-empty validation evidence before run completion', () => {
  const taskStatesWithValidation = (validation: unknown) => ({
    taskA: { status: 'passed', attempts: 1, validation },
  }) as unknown as Record<string, TaskState>

  assert.equal(transitionRun('running', 'completed', taskStatesWithValidation(undefined)).ok, false)
  assert.equal(transitionRun('running', 'completed', taskStatesWithValidation({ pass: false, code: 'failed', evidence: ['row 2 rejected'], retryable: true })).ok, false)
  assert.equal(transitionRun('running', 'completed', taskStatesWithValidation({ pass: true, code: 'accepted', evidence: [], retryable: false })).ok, false)
  assert.deepEqual(
    transitionRun('running', 'completed', taskStatesWithValidation({ pass: true, code: 'accepted', evidence: ['row 2 validated'], retryable: false })),
    { ok: true, value: 'completed' },
  )
})

test('running task may validate and pass', () => {
  const running = transitionTask({ status: 'pending', attempts: 0 }, 'start')
  assert.equal(running.ok, true)
  if (!running.ok) return
  assert.deepEqual(running.value, { status: 'running', attempts: 1 })

  const validating = transitionTask(running.value, 'begin_validation')
  assert.equal(validating.ok, true)
  if (!validating.ok) return
  assert.equal(validating.value.status, 'validating')

  const passed = transitionTask(validating.value, 'pass', {
    pass: true,
    code: 'accepted',
    evidence: ['Invoice row 2 passed required-field and currency checks.'],
    retryable: false,
  })
  assert.equal(passed.ok, true)
  if (passed.ok) assert.equal(passed.value.status, 'passed')
})

test('task cannot pass without a successful validation outcome and evidence', () => {
  const validating = { status: 'validating' as const, attempts: 1 }
  assert.equal(transitionTask(validating, 'pass').ok, false)
  assert.equal(transitionTask(validating, 'pass', { pass: false, code: 'missing_fields', evidence: ['row 2 missing invoice number'], retryable: true }).ok, false)
  assert.equal(transitionTask(validating, 'pass', { pass: true, code: 'accepted', evidence: [], retryable: false }).ok, false)
})

test('task retry flow counts the first run and cannot exceed three attempts', () => {
  let state: TaskState = { status: 'pending', attempts: 0 }
  for (let attempt = 0; attempt < DEFAULT_RUN_LIMITS.maxAttemptsPerTask; attempt += 1) {
    const started = transitionTask(state, 'start')
    assert.equal(started.ok, true)
    if (!started.ok) return
    state = started.value
    if (attempt < DEFAULT_RUN_LIMITS.maxAttemptsPerTask - 1) {
      const retry = transitionTask(state, 'retry')
      assert.equal(retry.ok, true)
      if (!retry.ok) return
      state = retry.value
    }
  }

  assert.deepEqual(state, { status: 'running', attempts: 3 })
  const retry = transitionTask(state, 'retry')
  assert.equal(retry.ok, true)
  if (retry.ok) {
    const exhausted = transitionTask(retry.value, 'start')
    assert.equal(exhausted.ok, false)
    if (!exhausted.ok) assert.equal(exhausted.issues[0].code, 'attempt_limit')
  }
})

test('workflow validator enforces known tools, task and parameter bounds', () => {
  const workflow = {
    version: 1,
    goal: 'Filter HKD invoices over the threshold.',
    steps: [
      { id: 'parse', dependencies: [], tool: 'parse_invoice_rows', inputRefs: ['source'], acceptance: [] },
      { id: 'filter', dependencies: ['parse'], tool: 'filter_invoice_rows', inputRefs: ['parse'], parameters: { thresholdMinor: 1_000_000, currency: 'HKD' }, acceptance: [] },
    ],
    parameters: { thresholdMinor: 1_000_000, currency: 'HKD' },
    allowedTools: ['parse_invoice_rows', 'filter_invoice_rows'],
    acceptance: [{ id: 'amount', type: 'minimum_amount_minor', thresholdMinor: 1_000_000 }],
  }
  assert.equal(validateWorkflow(workflow).ok, true)
  assert.equal(validateWorkflow({ ...workflow, steps: Array(6).fill(workflow.steps[0]) }).ok, false)
  assert.equal(validateWorkflow({ ...workflow, steps: [{ ...workflow.steps[0], tool: 'run_shell' }] }).ok, false)
  assert.equal(validateWorkflow({ ...workflow, parameters: { thresholdMinor: -1, currency: 'HKD' } }).ok, false)
})

test('run limit validator enforces active run, model request, task, model-call and timeout caps', () => {
  const base = {
    activeRuns: 1,
    activeModelRequests: 1,
    taskCount: 5,
    attemptsForCurrentTask: 3,
    modelCallsForRun: 20,
    modelRequestElapsedMs: 120_000,
    runElapsedMs: 600_000,
  }
  assert.equal(validateRunLimits(base, DEFAULT_RUN_LIMITS).ok, true)
  assert.equal(validateRunLimits({ ...base, activeRuns: 2 }, DEFAULT_RUN_LIMITS).ok, false)
  assert.equal(validateRunLimits({ ...base, activeModelRequests: 2 }, DEFAULT_RUN_LIMITS).ok, false)
  assert.equal(validateRunLimits({ ...base, taskCount: 6 }, DEFAULT_RUN_LIMITS).ok, false)
  assert.equal(validateRunLimits({ ...base, attemptsForCurrentTask: 4 }, DEFAULT_RUN_LIMITS).ok, false)
  assert.equal(validateRunLimits({ ...base, modelCallsForRun: 21 }, DEFAULT_RUN_LIMITS).ok, false)
  assert.equal(validateRunLimits({ ...base, modelRequestElapsedMs: 120_001 }, DEFAULT_RUN_LIMITS).ok, false)
  assert.equal(validateRunLimits({ ...base, runElapsedMs: 600_001 }, DEFAULT_RUN_LIMITS).ok, false)
})
