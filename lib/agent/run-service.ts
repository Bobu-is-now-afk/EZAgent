import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  DEFAULT_RUN_LIMITS,
  type Artifact,
  type Run,
  type RunEvent,
  type RunStatus,
  type TaskState,
  type ValidationIssue,
  type ValidationResult,
  type WorkflowDefinition,
} from './contracts'
import { getSourceCurrencies, InvoiceToolError, executeInvoiceWorkflow, type InvoiceSource } from './executor'
import { AgentStoreError, createAgentStore, type AgentStore } from './store'
import { transitionRun, transitionTask } from './state-machine'
import { validateWorkflowForRun } from './planner'

type ActiveRun = { runId: string; idempotencyHash: string; fingerprint: string; controller: AbortController }
type RuntimeState = { store?: Promise<AgentStore>; active: ActiveRun | null; creationQueue: Promise<void> }
const runtimeGlobal = globalThis as typeof globalThis & { __ezagentRunRuntimesV1?: Map<string, RuntimeState> }
const runtimes = runtimeGlobal.__ezagentRunRuntimesV1 ??= new Map()

export class RunServiceError extends Error {
  readonly code: string
  readonly status: number
  readonly issues?: Array<Pick<ValidationIssue, 'path' | 'code'>>

  constructor(code: string, message: string, status: number, issues?: ValidationIssue[]) {
    super(message)
    this.name = 'RunServiceError'
    this.code = code
    this.status = status
    if (issues) this.issues = issues.slice(0, 10).map(({ path, code: issueCode }) => ({
      path: path.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120),
      code: issueCode.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
    }))
  }
}

function safeError(code: string, message: string, status = 400): RunServiceError {
  return new RunServiceError(code, message, status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

type ResumeCorrection = { field: 'currency' | 'thresholdMinor'; value: string }

function parseResumeInput(input: unknown): { taskId: string; corrections: ResumeCorrection[] } | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['taskId', 'corrections']) || typeof input.taskId !== 'string' || !Array.isArray(input.corrections) || input.corrections.length < 1 || input.corrections.length > 2) return null
  const seen = new Set<string>()
  const corrections: ResumeCorrection[] = []
  for (const item of input.corrections) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['field', 'value']) || typeof item.field !== 'string' || typeof item.value !== 'string' || item.value.trim() !== item.value || item.value.length === 0 || item.value.length > 32) return null
    if ((item.field !== 'currency' && item.field !== 'thresholdMinor') || seen.has(item.field)) return null
    seen.add(item.field)
    if (item.field === 'currency' && !/^[A-Z]{3}$/.test(item.value)) return null
    if (item.field === 'thresholdMinor' && (!/^\d{1,16}$/.test(item.value) || !Number.isSafeInteger(Number(item.value)))) return null
    corrections.push({ field: item.field, value: item.value })
  }
  return { taskId: input.taskId, corrections }
}

function applyCorrections(workflow: WorkflowDefinition, corrections: ResumeCorrection[]): WorkflowDefinition {
  const next = structuredClone(workflow)
  const filterStep = next.steps.find((step) => step.tool === 'filter_invoice_rows')!
  const values = { currency: next.parameters.currency ?? '', thresholdMinor: next.parameters.thresholdMinor ?? 0 }
  for (const correction of corrections) {
    if (correction.field === 'currency') values.currency = correction.value
    else values.thresholdMinor = Number(correction.value)
  }
  next.parameters = values
  filterStep.parameters = { currency: values.currency, thresholdMinor: values.thresholdMinor }
  if (next.pills) {
    next.pills = next.pills.map((pill) => {
      if (pill.id === 'step:filter:currency') return { ...pill, value: values.currency }
      if (pill.id === 'step:filter:thresholdMinor') return { ...pill, value: values.thresholdMinor }
      return pill
    })
  }
  for (const collection of [next.acceptance, filterStep.acceptance]) {
    for (const criterion of collection) {
      if (criterion.type === 'currency_exact') criterion.currency = values.currency
      else if (criterion.type === 'minimum_amount_minor') criterion.thresholdMinor = values.thresholdMinor
    }
  }
  return next
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function taskMap(workflow: WorkflowDefinition): Record<string, TaskState> {
  return Object.fromEntries(workflow.steps.map((step) => [step.id, { status: 'pending' as const, attempts: 0 }]))
}

function transition(status: RunStatus, to: RunStatus, taskStates?: Readonly<Record<string, TaskState>>): RunStatus {
  const result = transitionRun(status, to, taskStates)
  if (!result.ok) throw safeError('invalid_run_transition', 'Run status cannot advance safely.', 409)
  return result.value
}

async function writeImmutable(path: string, contents: string): Promise<void> {
  let file
  let created = false
  try {
    file = await open(path, 'wx', 0o600)
    created = true
    await file.writeFile(contents, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
  } catch {
    if (file) await file.close().catch(() => undefined)
    if (created) await unlink(path).catch(() => undefined)
    throw safeError('artifact_write_failed', 'Agent data could not be stored safely.', 500)
  }
}

async function withCreationLock<T>(state: RuntimeState, operation: () => Promise<T>): Promise<T> {
  const previous = state.creationQueue
  let release: () => void = () => undefined
  state.creationQueue = new Promise<void>((resolveQueue) => { release = resolveQueue })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

export type AgentRunService = ReturnType<typeof createAgentRunService>

export function createAgentRunService(root = resolve(process.cwd(), '.ezagent')) {
  const resolvedRoot = resolve(root)
  let state = runtimes.get(resolvedRoot)
  if (!state) {
    state = { active: null, creationQueue: Promise.resolve() }
    runtimes.set(resolvedRoot, state)
  }
  const runtime = state as RuntimeState
  const sourcesRoot = resolve(resolvedRoot, 'sources')
  const artifactsRoot = resolve(resolvedRoot, 'artifacts')
  const getStore = () => runtime.store ??= createAgentStore(resolvedRoot)

  async function getStoredSource(runId: string): Promise<InvoiceSource> {
    let raw: string
    try {
      raw = await readFile(resolve(sourcesRoot, `${runId}.json`), 'utf8')
    } catch {
      throw safeError('source_unavailable', 'Stored source is unavailable for this run.', 409)
    }
    try {
      const source = JSON.parse(raw) as unknown
      if (!isRecord(source) || typeof source.name !== 'string' || (source.type !== 'csv' && source.type !== 'text') || typeof source.content !== 'string') {
        throw new Error('invalid')
      }
      return source as InvoiceSource
    } catch {
      throw safeError('source_unavailable', 'Stored source is unavailable for this run.', 409)
    }
  }

  async function appendEvent(store: AgentStore, runId: string, type: string, payload: unknown, taskId?: string): Promise<RunEvent> {
    return store.appendEvent({ runId, type, payload, ...(taskId ? { taskId } : {}) })
  }

  async function setRunFailed(store: AgentStore, runId: string, taskId: string | null, validation?: ValidationResult): Promise<Run | null> {
    const current = await store.getRun(runId)
    if (!current || current.status === 'completed' || current.status === 'cancelled' || current.status === 'failed') return current
    if (taskId && validation) {
      const state = current.taskStates[taskId]
      if (state && state.status !== 'passed' && state.status !== 'failed') {
        const failedState = transitionTask(state, 'fail', undefined, current.limits)
        if (failedState.ok) current.taskStates = { ...current.taskStates, [taskId]: { ...failedState.value, validation } }
      }
    }
    current.currentTask = taskId
    current.status = transition(current.status, 'failed')
    current.updatedAt = new Date().toISOString()
    const saved = await store.saveRun(current)
    await appendEvent(store, runId, 'run_failed', { code: validation?.code ?? 'run_failed', message: 'Run stopped after a deterministic validation or execution failure.' }, taskId ?? undefined)
    return saved
  }

  async function processRun(runId: string, signal: AbortSignal): Promise<void> {
    const store = await getStore()
    let activeTaskId: string | null = null
    try {
      const run = await store.getRun(runId)
      if (!run) throw safeError('run_not_found', 'Run does not exist.', 404)
      const source = await getStoredSource(runId)
      const execution = executeInvoiceWorkflow(run.workflow, source)

      for (let index = 0; index < execution.taskOutcomes.length; index += 1) {
        if (signal.aborted) break
        const outcome = execution.taskOutcomes[index]
        activeTaskId = outcome.taskId
        const current = await store.getRun(runId)
        if (!current) throw safeError('run_not_found', 'Run does not exist.', 404)
        if (current.status === 'cancelling') break
        if (current.taskStates[outcome.taskId]?.status === 'passed') continue

        let taskState = transitionTask(current.taskStates[outcome.taskId], 'start', undefined, current.limits)
        if (!taskState.ok) throw safeError('task_transition_failed', 'Workflow task could not start.', 500)
        current.taskStates = { ...current.taskStates, [outcome.taskId]: taskState.value }
        current.currentTask = outcome.taskId
        current.updatedAt = new Date().toISOString()
        await store.saveRun(current)
        await appendEvent(store, runId, 'task_started', { tool: outcome.tool }, outcome.taskId)

        const validating = transitionTask(taskState.value, 'begin_validation', undefined, current.limits)
        if (!validating.ok) throw safeError('task_transition_failed', 'Workflow task validation could not start.', 500)
        current.taskStates = { ...current.taskStates, [outcome.taskId]: validating.value }
        current.updatedAt = new Date().toISOString()
        await store.saveRun(current)

        if (!outcome.validation.pass && outcome.validation.retryable) {
          const latest = await store.getRun(runId)
          if (!latest) throw safeError('run_not_found', 'Run does not exist.', 404)
          const state = latest.taskStates[outcome.taskId]
          if (state.attempts >= latest.limits.maxAttemptsPerTask) {
            const failedState = transitionTask(state, 'fail', undefined, latest.limits)
            if (!failedState.ok) throw safeError('task_transition_failed', 'Workflow task could not fail safely.', 500)
            latest.taskStates = { ...latest.taskStates, [outcome.taskId]: { ...failedState.value, validation: outcome.validation } }
            latest.status = transition(latest.status, 'failed')
            latest.currentTask = outcome.taskId
            latest.updatedAt = new Date().toISOString()
            await store.saveRun(latest)
            await appendEvent(store, runId, 'run_failed', { code: outcome.validation.code, message: 'Run stopped after the task retry limit was reached.' }, outcome.taskId)
            return
          }
          const needsInput = transitionTask(state, 'need_input', undefined, latest.limits)
          if (!needsInput.ok) throw safeError('task_transition_failed', 'Workflow task could not request input safely.', 500)
          latest.taskStates = { ...latest.taskStates, [outcome.taskId]: { ...needsInput.value, validation: outcome.validation } }
          latest.status = transition(latest.status, 'needs_input', latest.taskStates)
          latest.currentTask = outcome.taskId
          latest.updatedAt = new Date().toISOString()
          await store.saveRun(latest)
          await appendEvent(store, runId, 'needs_input', {
            code: outcome.validation.code,
            message: 'No source rows match the current filter. Correct the currency or threshold to continue.',
            allowedCorrections: ['currency', 'thresholdMinor'],
          }, outcome.taskId)
          return
        }
        if (!outcome.validation.pass) {
          await setRunFailed(store, runId, outcome.taskId, outcome.validation)
          return
        }

        taskState = transitionTask(validating.value, 'pass', outcome.validation, current.limits)
        if (!taskState.ok) throw safeError('task_validation_failed', 'Workflow task output failed hard validation.', 500)
        const latest = await store.getRun(runId)
        if (!latest) throw safeError('run_not_found', 'Run does not exist.', 404)
        latest.taskStates = { ...latest.taskStates, [outcome.taskId]: taskState.value }
        latest.currentTask = execution.taskOutcomes[index + 1]?.taskId ?? null
        latest.updatedAt = new Date().toISOString()
        await store.saveRun(latest)
        await appendEvent(store, runId, 'task_passed', { validation: outcome.validation }, outcome.taskId)
      }

      const latest = await store.getRun(runId)
      if (!latest) throw safeError('run_not_found', 'Run does not exist.', 404)
      if (signal.aborted || latest.status === 'cancelling') {
        latest.status = transition(latest.status, 'cancelled')
        latest.currentTask = null
        latest.updatedAt = new Date().toISOString()
        await store.saveRun(latest)
        await appendEvent(store, runId, 'run_cancelled', { message: 'Run was cancelled before artifact commitment.' })
        return
      }
      if (execution.taskOutcomes.some(({ taskId }) => latest.taskStates[taskId]?.status !== 'passed')) {
        throw safeError('task_validation_failed', 'Not every workflow task passed hard validation.', 500)
      }

      await mkdir(artifactsRoot, { recursive: true, mode: 0o700 })
      const artifactId = randomUUID()
      const artifactPath = resolve(artifactsRoot, `${artifactId}.csv`)
      await writeImmutable(artifactPath, execution.csv)
      const exportOutcome = execution.taskOutcomes.at(-1)?.validation
      if (!exportOutcome) throw safeError('artifact_validation_failed', 'CSV artifact has no validation evidence.', 500)
      const artifact: Artifact = {
        id: artifactId,
        type: 'text/csv',
        location: `/api/agent/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        sourceRefs: execution.sourceRefs,
        validation: exportOutcome,
      }
      latest.artifacts = [...latest.artifacts, artifact]
      latest.status = transition(latest.status, 'completed', latest.taskStates)
      latest.currentTask = null
      latest.updatedAt = new Date().toISOString()
      await store.saveRun(latest)
      await appendEvent(store, runId, 'run_completed', { artifactId, rowCount: execution.sourceRefs.length })
    } catch (error) {
      if (error instanceof InvoiceToolError) {
        await setRunFailed(store, runId, error.taskId || activeTaskId, error.validation).catch(() => undefined)
      } else {
        await setRunFailed(store, runId, activeTaskId, {
          pass: false,
          code: error instanceof RunServiceError ? error.code : 'run_failed',
          evidence: ['A deterministic workflow step could not complete.'],
          retryable: false,
        }).catch(() => undefined)
      }
    } finally {
      if (runtime.active?.runId === runId && runtime.active.controller.signal === signal) runtime.active = null
    }
  }

  function launch(runId: string): void {
    const controller = runtime.active?.runId === runId ? runtime.active.controller : new AbortController()
    if (runtime.active?.runId !== runId) runtime.active = { runId, idempotencyHash: '', fingerprint: '', controller }
    void processRun(runId, controller.signal)
  }

  return {
    async createRun(input: unknown): Promise<{ run: Run; created: boolean }> {
      if (!isRecord(input) || !hasOnlyKeys(input, ['workflow', 'source', 'idempotencyKey']) ||
          !isRecord(input.workflow) || !isRecord(input.source) || typeof input.idempotencyKey !== 'string' ||
          input.idempotencyKey.trim().length === 0 || input.idempotencyKey.length > 512) {
        throw safeError('invalid_request', 'Run request must contain a workflow, source, and idempotency key.')
      }
      const source = input.source
      if (typeof source.name !== 'string' || (source.type !== 'csv' && source.type !== 'text') || typeof source.content !== 'string') {
        throw safeError('invalid_source', 'Run source is invalid.')
      }
      const validation = validateWorkflowForRun(input.workflow, source as InvoiceSource)
      if (!validation.ok) throw new RunServiceError('invalid_workflow', 'Run workflow failed invoice demo validation.', 400, validation.issues)
      const workflow = validation.value
      const validatedSource = source as InvoiceSource
      const fingerprint = sha256(JSON.stringify({ workflow, source: validatedSource }))
      const idempotencyHash = sha256(input.idempotencyKey)
      const store = await getStore()
      return withCreationLock(runtime, async () => {
        try {
          const existing = await store.findRunByIdempotencyKey(input.idempotencyKey as string, fingerprint)
          if (existing) return { run: existing, created: false }
        } catch (error) {
          if (error instanceof AgentStoreError && error.code === 'idempotency_conflict') {
            throw safeError('idempotency_conflict', 'Idempotency key was already used with different run input.', 409)
          }
          throw safeError('run_storage_failed', 'Run could not be read safely.', 500)
        }
        if (runtime.active && (runtime.active.idempotencyHash !== idempotencyHash || runtime.active.fingerprint !== fingerprint)) {
          throw safeError('active_run_limit', 'Another invoice workflow is currently running.', 429)
        }
        const now = new Date().toISOString()
        const run: Run = {
          id: randomUUID(),
          workflowVersion: 1,
          status: 'running',
          limits: { ...DEFAULT_RUN_LIMITS },
          currentTask: workflow.steps[0].id,
          createdAt: now,
          updatedAt: now,
          workflow,
          taskStates: taskMap(workflow),
          artifacts: [],
        }
        let created
        try {
          created = await store.createRun({ idempotencyKey: input.idempotencyKey as string, payloadFingerprint: fingerprint, run })
        } catch (error) {
          if (error instanceof AgentStoreError && error.code === 'idempotency_conflict') {
            throw safeError('idempotency_conflict', 'Idempotency key was already used with different run input.', 409)
          }
          throw safeError('run_storage_failed', 'Run could not be stored safely.', 500)
        }
        if (!created.created) return { run: created.run, created: false }
        const controller = new AbortController()
        runtime.active = { runId: created.run.id, idempotencyHash, fingerprint, controller }
        try {
          await mkdir(sourcesRoot, { recursive: true, mode: 0o700 })
          await writeImmutable(resolve(sourcesRoot, `${created.run.id}.json`), JSON.stringify(validatedSource))
          await appendEvent(store, created.run.id, 'run_started', { taskCount: workflow.steps.length })
        } catch {
          await setRunFailed(store, created.run.id, null).catch(() => undefined)
          runtime.active = null
          throw safeError('run_storage_failed', 'Run source could not be stored safely.', 500)
        }
        launch(created.run.id)
        return { run: created.run, created: true }
      })
    },

    async getRun(runId: string): Promise<Run | null> {
      return (await getStore()).getRun(runId)
    },

    async listEvents(runId: string, afterSequence = 0): Promise<{ events: RunEvent[]; nextSequence: number }> {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw safeError('invalid_cursor', 'Event cursor is invalid.')
      const store = await getStore()
      if (!(await store.getRun(runId))) throw safeError('run_not_found', 'Run does not exist.', 404)
      return store.listEvents(runId, afterSequence)
    },

    async cancelRun(runId: string): Promise<Run> {
      const store = await getStore()
      const run = await store.getRun(runId)
      if (!run) throw safeError('run_not_found', 'Run does not exist.', 404)
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') return run
      if (run.status === 'running' || run.status === 'needs_input') run.status = transition(run.status, 'cancelling')
      else if (run.status === 'interrupted') {
        run.status = transition(run.status, 'cancelled')
        run.currentTask = null
        run.updatedAt = new Date().toISOString()
        const cancelled = await store.saveRun(run)
        await appendEvent(store, runId, 'run_cancelled', { message: 'Run was cancelled before resuming.' })
        return cancelled
      }
      run.updatedAt = new Date().toISOString()
      const saved = await store.saveRun(run)
      runtime.active?.runId === runId && runtime.active.controller.abort()
      await appendEvent(store, runId, 'run_cancelling', { message: 'Cancellation requested.' })
      if (!runtime.active || runtime.active.runId !== runId) {
        const current = await store.getRun(runId)
        if (current?.status === 'cancelling') {
          current.status = transition(current.status, 'cancelled')
          current.currentTask = null
          current.updatedAt = new Date().toISOString()
          const cancelled = await store.saveRun(current)
          await appendEvent(store, runId, 'run_cancelled', { message: 'Run was cancelled before resuming.' })
          return cancelled
        }
      }
      return saved
    },

    async resumeRun(runId: string, rawInput?: unknown): Promise<Run> {
      const store = await getStore()
      return withCreationLock(runtime, async () => {
        const run = await store.getRun(runId)
        if (!run) throw safeError('run_not_found', 'Run does not exist.', 404)
        if (run.status !== 'needs_input' && run.status !== 'interrupted') {
          throw safeError('run_not_resumable', 'Only interrupted or actionable runs can resume.', 409)
        }
        if (runtime.active && (runtime.active.runId !== runId || (run.status !== 'needs_input' && run.status !== 'interrupted'))) {
          throw safeError('active_run_limit', 'Another invoice workflow is currently running.', 429)
        }
        if (runtime.active?.runId === runId) runtime.active = null
        if (run.artifacts.length > 0) throw safeError('run_not_resumable', 'Runs with committed artifacts cannot resume.', 409)
        const source = await getStoredSource(runId)
        if (run.status === 'needs_input') {
          const parsed = parseResumeInput(rawInput)
          if (!parsed || parsed.taskId !== run.currentTask || parsed.taskId !== run.workflow.steps.find((step) => step.tool === 'filter_invoice_rows')?.id) {
            throw safeError('invalid_resume_input', 'Provide corrections for the current filter task using the supported fields.', 400)
          }
          const task = run.taskStates[parsed.taskId]
          if (!task || task.status !== 'needs_input' || task.attempts >= run.limits.maxAttemptsPerTask) throw safeError('run_not_resumable', 'The current task cannot accept another correction.', 409)
          for (const correction of parsed.corrections) {
            if (correction.field === 'currency' && !getSourceCurrencies(source).includes(correction.value)) {
              throw safeError('invalid_resume_input', 'Currency correction must match a currency present in the source.', 400)
            }
          }
          const corrected = applyCorrections(run.workflow, parsed.corrections)
          const validation = validateWorkflowForRun(corrected, source)
          if (!validation.ok) throw safeError('invalid_resume_input', 'Corrected workflow failed invoice demo validation.', 400)
          run.workflow = validation.value
          run.workflowVersion += 1
          const retry = transitionTask(task, 'retry', undefined, run.limits)
          if (!retry.ok) throw safeError('run_not_resumable', 'The current task cannot be retried safely.', 409)
          run.taskStates = { ...run.taskStates, [parsed.taskId]: retry.value }
          run.status = transition(run.status, 'running', run.taskStates)
          run.currentTask = parsed.taskId
          run.updatedAt = new Date().toISOString()
          const saved = await store.saveRun(run)
          const controller = new AbortController()
          runtime.active = { runId, idempotencyHash: '', fingerprint: '', controller }
          await appendEvent(store, runId, 'workflow_corrected', { fields: parsed.corrections.map(({ field }) => field), workflowVersion: run.workflowVersion }, parsed.taskId)
          await appendEvent(store, runId, 'run_resumed', { taskCount: run.workflow.steps.length }, parsed.taskId)
          launch(runId)
          return saved
        }
        if (run.status !== 'interrupted' || rawInput !== undefined) throw safeError('run_not_resumable', 'Only interrupted runs accept an empty resume request.', 409)
        const currentTaskId = run.currentTask ?? run.workflow.steps.find((step) => run.taskStates[step.id]?.status !== 'passed')?.id ?? run.workflow.steps.at(-1)?.id ?? null
        if (!currentTaskId) throw safeError('run_not_resumable', 'Run has no unfinished task to resume.', 409)
        const currentTask = run.taskStates[currentTaskId]
        if (currentTask?.status === 'running' || currentTask?.status === 'validating' || currentTask?.status === 'needs_input') {
          if (currentTask.attempts >= run.limits.maxAttemptsPerTask) throw safeError('run_not_resumable', 'The current task has exhausted its retry limit.', 409)
          const retry = transitionTask(currentTask, 'retry', undefined, run.limits)
          if (!retry.ok) throw safeError('run_not_resumable', 'The current task cannot be resumed safely.', 409)
          run.taskStates = { ...run.taskStates, [currentTaskId]: retry.value }
        }
        const validation = validateWorkflowForRun(run.workflow, source)
        if (!validation.ok) throw safeError('invalid_workflow', 'Stored workflow failed invoice demo validation.', 409)
        run.status = transition(run.status, 'running', run.taskStates)
        run.currentTask = currentTaskId
        run.updatedAt = new Date().toISOString()
        const saved = await store.saveRun(run)
        const controller = new AbortController()
        runtime.active = { runId, idempotencyHash: '', fingerprint: '', controller }
        await appendEvent(store, runId, 'run_resumed', { taskCount: run.workflow.steps.length }, currentTaskId)
        launch(runId)
        return saved
      })
    },

    async readArtifact(runId: string, artifactId: string): Promise<{ artifact: Artifact; contents: Uint8Array } | null> {
      const run = await (await getStore()).getRun(runId)
      const artifact = run?.artifacts.find((item) => item.id === artifactId && item.type === 'text/csv')
      if (!artifact) return null
      try {
        return { artifact, contents: await readFile(resolve(artifactsRoot, `${artifact.id}.csv`)) }
      } catch {
        throw safeError('artifact_unavailable', 'CSV artifact is unavailable.', 404)
      }
    },
  }
}

const defaultRoot = resolve(process.cwd(), '.ezagent')
const serviceMapGlobal = globalThis as typeof globalThis & { __ezagentRunServiceV1?: AgentRunService }
export const agentRunService = serviceMapGlobal.__ezagentRunServiceV1 ??= createAgentRunService(defaultRoot)

export function runServiceErrorResponse(error: unknown): Response {
  if (error instanceof RunServiceError) return Response.json({ error: {
    code: error.code,
    message: error.message,
    ...(error.issues ? { issues: error.issues } : {}),
  } }, { status: error.status })
  // Route Handler chunks may load separate copies of this module while sharing the global service singleton.
  if (isRecord(error) && error.name === 'RunServiceError' && typeof error.code === 'string' &&
      typeof error.message === 'string' && typeof error.status === 'number' &&
      [400, 404, 409, 429, 500].includes(error.status)) {
    const issues = Array.isArray(error.issues) ? error.issues.slice(0, 10).flatMap((value) => {
      if (!isRecord(value) || typeof value.path !== 'string' || typeof value.code !== 'string') return []
      return [{
        path: value.path.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120),
        code: value.code.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
      }]
    }) : undefined
    return Response.json({ error: {
      code: error.code,
      message: error.message,
      ...(issues ? { issues } : {}),
    } }, { status: error.status })
  }
  return Response.json({ error: { code: 'agent_error', message: 'The local invoice workflow could not complete the request.' } }, { status: 500 })
}

export function createRunPostHandler(service: AgentRunService = agentRunService) {
  return async function handleRunPost(request: Request): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 })
    }
    try {
      const result = await service.createRun(body)
      return Response.json({ run: result.run }, { status: result.created ? 202 : 200 })
    } catch (error) {
      return runServiceErrorResponse(error)
    }
  }
}

export function createResumePostHandler(service: AgentRunService = agentRunService) {
  return async function handleResumePost(request: Request, runId: string): Promise<Response> {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 })
    }
    if (!isRecord(body) || !hasOnlyKeys(body, ['input'])) {
      return Response.json({ error: { code: 'invalid_request', message: 'Resume request may contain only an input object.' } }, { status: 400 })
    }
    try {
      return Response.json({ run: await service.resumeRun(runId, body.input) })
    } catch (error) {
      return runServiceErrorResponse(error)
    }
  }
}

export function createCancelPostHandler(service: AgentRunService = agentRunService) {
  return async function handleCancelPost(_request: Request, runId: string): Promise<Response> {
    try {
      return Response.json({ run: await service.cancelRun(runId) })
    } catch (error) {
      return runServiceErrorResponse(error)
    }
  }
}
