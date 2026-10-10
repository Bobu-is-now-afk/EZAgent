import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import type { Artifact, Run, RunEvent, RunLimits, RunStatus, SourceReference, TaskState, ValidationResult } from './contracts'
import { createNextRunEvent, eventsAfter, type NewRunEvent } from './events'
import { transitionRun } from './state-machine'
import { validateWorkflow } from './validation'

const SNAPSHOT_FILE = 'snapshot.json'
const SNAPSHOT_VERSION = 1
const validRunStatuses = new Set<RunStatus>([
  'draft',
  'awaiting_approval',
  'running',
  'needs_input',
  'failed',
  'cancelling',
  'cancelled',
  'interrupted',
  'completed',
])

type IdempotencyEntry = { fingerprint: string; runId: string }

type StoreSnapshot = {
  version: 1
  runs: Run[]
  idempotency: Record<string, IdempotencyEntry>
  events: Record<string, RunEvent[]>
}

export class AgentStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentStoreError'
    this.code = code
  }
}

export type CreateRunInput = {
  idempotencyKey: string
  payloadFingerprint: string
  run: Run
}

export type CreateRunResult = { run: Run; created: boolean }

export type AgentStore = {
  createRun(input: CreateRunInput): Promise<CreateRunResult>
  findRunByIdempotencyKey(idempotencyKey: string, payloadFingerprint: string): Promise<Run | null>
  getRun(runId: string): Promise<Run | null>
  saveRun(run: Run): Promise<Run>
  appendEvent(input: NewRunEvent): Promise<RunEvent>
  listEvents(runId: string, afterSequence?: number): Promise<{ events: RunEvent[]; nextSequence: number }>
}

type ProcessRegistry = {
  writeQueues: Map<string, Promise<void>>
  recoveredRoots: Set<string>
}

const processGlobal = globalThis as typeof globalThis & { __ezagentStoreRegistryV1?: ProcessRegistry }
const processRegistry = processGlobal.__ezagentStoreRegistryV1 ??= {
  writeQueues: new Map<string, Promise<void>>(),
  recoveredRoots: new Set<string>(),
}

// Serializes and recovers all store instances in this Node process, including Next dev module reloads.
// Multiple processes must not share a root; there is intentionally no cross-process lock or lease.
const processWriteQueues = processRegistry.writeQueues
const recoveredRoots = processRegistry.recoveredRoots

function withProcessWriter<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = processWriteQueues.get(root) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  const queued = previous.then(() => gate)
  processWriteQueues.set(root, queued)

  return previous.then(operation).finally(() => {
    release()
    if (processWriteQueues.get(root) === queued) processWriteQueues.delete(root)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isValidationResult(value: unknown, requirePassingEvidence = false): value is ValidationResult {
  return isRecord(value) && typeof value.pass === 'boolean' && isNonEmptyString(value.code) &&
    isStringArray(value.evidence) && typeof value.retryable === 'boolean' &&
    (!requirePassingEvidence || (value.pass && value.evidence.length > 0))
}

function isTaskState(value: unknown): value is TaskState {
  if (!isRecord(value) || !validTaskStatuses.has(value.status as string)) return false
  if (!Number.isInteger(value.attempts) || (value.attempts as number) < 0) return false
  if (value.status === 'passed') {
    return isValidationResult(value.validation, true)
  }
  return value.validation === undefined || isValidationResult(value.validation)
}

const validTaskStatuses = new Set(['pending', 'running', 'validating', 'passed', 'retry_pending', 'needs_input', 'failed'])

function isRunLimits(value: unknown): value is RunLimits {
  if (!isRecord(value)) return false
  const fields = [
    'maxActiveRuns', 'maxModelRequests', 'maxTasks', 'maxAttemptsPerTask',
    'maxModelCallsPerRun', 'modelRequestTimeoutMs', 'runTimeoutMs',
  ] as const
  return Object.keys(value).length === fields.length && fields.every((field) =>
    Number.isSafeInteger(value[field]) && (value[field] as number) > 0,
  )
}

function isSourceReference(value: unknown): value is SourceReference {
  if (!isRecord(value) || !isNonEmptyString(value.fileName)) return false
  const hasRow = Number.isSafeInteger(value.rowNumber) && (value.rowNumber as number) > 0 && value.lineNumber === undefined
  const hasLine = Number.isSafeInteger(value.lineNumber) && (value.lineNumber as number) > 0 && value.rowNumber === undefined
  return hasRow || hasLine
}

function isArtifact(value: unknown): value is Artifact {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.type) &&
    isNonEmptyString(value.location) && Array.isArray(value.sourceRefs) &&
    value.sourceRefs.every(isSourceReference) && isValidationResult(value.validation)
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every((entry) => isJsonValue(entry, seen))
  seen.delete(value)
  return valid
}

function isRun(value: unknown): value is Run {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && Number.isInteger(value.workflowVersion) &&
    (value.workflowVersion as number) > 0 && validRunStatuses.has(value.status as RunStatus) && isRunLimits(value.limits) &&
    (value.currentTask === null || isNonEmptyString(value.currentTask)) &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) &&
    validateWorkflow(value.workflow).ok && isRecord(value.taskStates) &&
    Object.values(value.taskStates).every((taskState) => isTaskState(taskState) && taskState.attempts <= (value.limits as RunLimits).maxAttemptsPerTask) &&
    Array.isArray(value.artifacts) && value.artifacts.every(isArtifact) &&
    new Set((value.artifacts as Artifact[]).map((artifact) => artifact.id)).size === value.artifacts.length
}

function isRunEvent(value: unknown, runId: string, expectedSequence: number): value is RunEvent {
  return isRecord(value) && isNonEmptyString(value.id) && value.runId === runId &&
    value.sequence === expectedSequence && typeof value.time === 'string' &&
    isNonEmptyString(value.type) && 'payload' in value &&
    isJsonValue(value.payload) && (value.taskId === undefined || isNonEmptyString(value.taskId))
}

function emptySnapshot(): StoreSnapshot {
  return { version: SNAPSHOT_VERSION, runs: [], idempotency: {}, events: {} }
}

function isSnapshot(value: unknown): value is StoreSnapshot {
  if (!isRecord(value) || value.version !== SNAPSHOT_VERSION || !Array.isArray(value.runs) ||
      !isRecord(value.idempotency) || !isRecord(value.events)) return false
  if (!value.runs.every(isRun)) return false
  const runIds = new Set((value.runs as Run[]).map((run) => run.id))
  const storedEvents = value.events
  if (runIds.size !== value.runs.length) return false
  if ([...runIds].some((runId) => !Object.hasOwn(storedEvents, runId))) return false

  for (const [runId, events] of Object.entries(value.events)) {
    if (!runIds.has(runId) || !Array.isArray(events) ||
        !events.every((event, index) => isRunEvent(event, runId, index + 1))) return false
  }
  const idempotentRunIds = new Set<string>()
  for (const [keyHash, entry] of Object.entries(value.idempotency)) {
    if (!/^[a-f0-9]{64}$/.test(keyHash) || !isRecord(entry) ||
        !/^[a-f0-9]{64}$/.test(String(entry.fingerprint)) ||
        typeof entry.runId !== 'string' || !runIds.has(entry.runId) || idempotentRunIds.has(entry.runId)) return false
    idempotentRunIds.add(entry.runId)
  }
  return idempotentRunIds.size === runIds.size
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function safeError(code: string, message: string): AgentStoreError {
  return new AgentStoreError(code, message)
}

class FileAgentStore implements AgentStore {
  private readonly root: string
  private readonly snapshotPath: string

  constructor(root: string) {
    this.root = resolve(root)
    this.snapshotPath = resolve(this.root, SNAPSHOT_FILE)
  }

  async initialize(): Promise<void> {
    await withProcessWriter(this.root, async () => {
      try {
        await mkdir(this.root, { recursive: true })
        if (recoveredRoots.has(this.root)) {
          const existingSnapshot = await this.readSnapshot()
          if (!existingSnapshot) throw safeError('invalid_snapshot', 'Agent store snapshot is missing.')
          return
        }

        let snapshot = await this.readSnapshot()
        if (!snapshot) {
          snapshot = emptySnapshot()
          await this.writeSnapshot(snapshot)
          recoveredRoots.add(this.root)
          return
        }

        let recovered = false
        for (const run of snapshot.runs) {
          if (run.status !== 'running' && run.status !== 'cancelling') continue
          const previousStatus = run.status
          const result = transitionRun(previousStatus, 'interrupted')
          if (!result.ok) throw safeError('invalid_snapshot', 'Stored run state cannot be recovered safely.')
          run.status = result.value
          run.updatedAt = new Date().toISOString()
          const priorEvents = snapshot.events[run.id] ?? []
          snapshot.events[run.id] = [
            ...priorEvents,
            createNextRunEvent(priorEvents, {
              runId: run.id,
              type: 'run_interrupted',
              payload: { previousStatus, reason: 'process_restart' },
            }, run.updatedAt),
          ]
          recovered = true
        }
        if (recovered) await this.writeSnapshot(snapshot)
        recoveredRoots.add(this.root)
      } catch (error) {
        if (error instanceof AgentStoreError) throw error
        throw safeError('store_io', 'Agent store could not be initialized.')
      }
    })
  }

  async createRun(input: CreateRunInput): Promise<CreateRunResult> {
    if (!isNonEmptyString(input.idempotencyKey) || input.idempotencyKey.length > 512 ||
        !/^[a-f0-9]{64}$/.test(input.payloadFingerprint) || !isRun(input.run)) {
      throw safeError('invalid_input', 'Run creation input is invalid.')
    }

    return withProcessWriter(this.root, async () => {
      const snapshot = await this.requireSnapshot()
      const idempotencyHash = hash(input.idempotencyKey)
      const fingerprint = input.payloadFingerprint
      const existing = snapshot.idempotency[idempotencyHash]
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw safeError('idempotency_conflict', 'Idempotency key was already used with a different request.')
        }
        const existingRun = snapshot.runs.find((run) => run.id === existing.runId)
        if (!existingRun) throw safeError('invalid_snapshot', 'Stored idempotency reference is invalid.')
        return { run: existingRun, created: false }
      }
      if (snapshot.runs.some((run) => run.id === input.run.id)) {
        throw safeError('run_id_conflict', 'Run id already exists.')
      }

      snapshot.runs.push(input.run)
      snapshot.idempotency[idempotencyHash] = { fingerprint, runId: input.run.id }
      snapshot.events[input.run.id] = []
      await this.writeSnapshot(snapshot)
      return { run: input.run, created: true }
    })
  }

  async findRunByIdempotencyKey(idempotencyKey: string, payloadFingerprint: string): Promise<Run | null> {
    if (!isNonEmptyString(idempotencyKey) || idempotencyKey.length > 512 || !/^[a-f0-9]{64}$/.test(payloadFingerprint)) {
      throw safeError('invalid_input', 'Idempotency lookup input is invalid.')
    }
    return withProcessWriter(this.root, async () => {
      const snapshot = await this.requireSnapshot()
      const entry = snapshot.idempotency[hash(idempotencyKey)]
      if (!entry) return null
      if (entry.fingerprint !== payloadFingerprint) throw safeError('idempotency_conflict', 'Idempotency key was already used with a different request.')
      const run = snapshot.runs.find((item) => item.id === entry.runId)
      if (!run) throw safeError('invalid_snapshot', 'Stored idempotency reference is invalid.')
      return run
    })
  }

  async getRun(runId: string): Promise<Run | null> {
    if (!isNonEmptyString(runId)) throw safeError('invalid_input', 'Run id is invalid.')
    return withProcessWriter(this.root, async () => {
      const snapshot = await this.requireSnapshot()
      return snapshot.runs.find((run) => run.id === runId) ?? null
    })
  }

  async saveRun(run: Run): Promise<Run> {
    if (!isRun(run)) throw safeError('invalid_input', 'Run data is invalid.')
    // This method persists state and protects committed artifacts; the runner must use
    // transitionTask/transitionRun before calling it to authorize any status change.
    return withProcessWriter(this.root, async () => {
      const snapshot = await this.requireSnapshot()
      const index = snapshot.runs.findIndex((storedRun) => storedRun.id === run.id)
      if (index < 0) throw safeError('run_not_found', 'Run does not exist.')
      const stored = snapshot.runs[index]
      const artifacts = [...stored.artifacts]
      for (const artifact of run.artifacts) {
        const committed = artifacts.find((candidate) => candidate.id === artifact.id)
        if (!committed) {
          artifacts.push(artifact)
        } else if (!isDeepStrictEqual(committed, artifact)) {
          throw safeError('artifact_conflict', 'A committed artifact cannot be replaced.')
        }
      }
      const nextRun = { ...run, artifacts }
      snapshot.runs[index] = nextRun
      await this.writeSnapshot(snapshot)
      return nextRun
    })
  }

  async appendEvent(input: NewRunEvent): Promise<RunEvent> {
    // Event payloads are metadata only; callers must never include imported source text or secrets.
    if (!isNonEmptyString(input.runId) || !isNonEmptyString(input.type) ||
        (input.taskId !== undefined && !isNonEmptyString(input.taskId)) || !isJsonValue(input.payload)) {
      throw safeError('invalid_input', 'Event input is invalid.')
    }
    return withProcessWriter(this.root, async () => {
      const snapshot = await this.requireSnapshot()
      if (!snapshot.runs.some((run) => run.id === input.runId)) throw safeError('run_not_found', 'Run does not exist.')
      const priorEvents = snapshot.events[input.runId] ?? []
      const event = createNextRunEvent(priorEvents, input)
      snapshot.events[input.runId] = [...priorEvents, event]
      await this.writeSnapshot(snapshot)
      return event
    })
  }

  async listEvents(runId: string, afterSequence = 0): Promise<{ events: RunEvent[]; nextSequence: number }> {
    if (!isNonEmptyString(runId) || !Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw safeError('invalid_input', 'Event cursor is invalid.')
    }
    return withProcessWriter(this.root, async () => {
      const snapshot = await this.requireSnapshot()
      if (!snapshot.runs.some((run) => run.id === runId)) throw safeError('run_not_found', 'Run does not exist.')
      return eventsAfter(snapshot.events[runId] ?? [], afterSequence)
    })
  }

  private async requireSnapshot(): Promise<StoreSnapshot> {
    const snapshot = await this.readSnapshot()
    if (!snapshot) throw safeError('invalid_snapshot', 'Agent store snapshot is missing.')
    return snapshot
  }

  private async readSnapshot(): Promise<StoreSnapshot | null> {
    let contents: string
    try {
      contents = await readFile(this.snapshotPath, 'utf8')
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return null
      throw safeError('store_io', 'Agent store snapshot could not be read.')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      throw safeError('corrupt_snapshot', 'Agent store snapshot is corrupt; it was left unchanged.')
    }
    if (!isSnapshot(parsed)) throw safeError('corrupt_snapshot', 'Agent store snapshot is invalid; it was left unchanged.')
    return parsed
  }

  private async writeSnapshot(snapshot: StoreSnapshot): Promise<void> {
    const temporaryPath = resolve(this.root, `snapshot.${randomUUID()}.tmp`)
    let file
    try {
      const contents = JSON.stringify(snapshot)
      file = await open(temporaryPath, 'wx', 0o600)
      await file.writeFile(contents, 'utf8')
      await file.sync()
      await file.close()
      file = undefined
      await rename(temporaryPath, this.snapshotPath)
    } catch {
      if (file) await file.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw safeError('store_io', 'Agent store snapshot could not be written atomically.')
    }
  }
}

export async function createAgentStore(root = resolve(process.cwd(), '.ezagent')): Promise<AgentStore> {
  const store = new FileAgentStore(root)
  await store.initialize()
  return store
}
