import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

import { planWorkflow, PlannerError, validatePlanRequest, type PlanResponse } from '../agent/planner'

export const DEMO_PLAN_QUEUE = Object.freeze({ maxConcurrent: 1, maxPending: 2, queueTimeoutMs: 5 * 60_000, jobTimeoutMs: 120_000, recordRetentionMs: 24 * 60 * 60_000 })
export type DemoQueueLimits = { maxConcurrent: number; maxPending: number; queueTimeoutMs: number; jobTimeoutMs: number; recordRetentionMs: number }
export type DemoJobStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type DemoPlanJobView = {
  id: string
  type: 'plan'
  status: DemoJobStatus
  position: number | null
  planVersion: number
  sourceNameSha256: string
  sourceType: 'csv' | 'text'
  sourceSha256: string
  result?: PlanResponse
  errorCode?: string
  createdAt: string
  updatedAt: string
}

type PersistedJob = Omit<DemoPlanJobView, 'result'> & { ownerHash: string }
type LiveJob = PersistedJob & { ownerId: string; payload: unknown; controller?: AbortController; timer?: ReturnType<typeof setTimeout>; maintenanceTimer?: ReturnType<typeof setInterval>; result?: PlanResponse }
type PersistedJobs = { version: 1; jobs: PersistedJob[] }
type QueueState = { jobs: Map<string, LiveJob>; runningId: string | null; pumpActive: boolean; init?: Promise<void>; persistQueue: Promise<void>; admission: Promise<void>; retentionTimer?: ReturnType<typeof setTimeout>; storageFailed: boolean }
type QueueGlobal = typeof globalThis & { __ezagentDemoPlanQueuesV2?: Map<string, QueueState> }
const processGlobal = globalThis as QueueGlobal
const processQueues = processGlobal.__ezagentDemoPlanQueuesV2 ??= new Map()

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function makeState(): QueueState {
  return { jobs: new Map(), runningId: null, pumpActive: false, persistQueue: Promise.resolve(), admission: Promise.resolve(), storageFailed: false }
}

function asPersisted(job: LiveJob, position: number | null): PersistedJob {
  const { ownerId: _ownerId, payload: _payload, controller: _controller, timer: _timer, maintenanceTimer: _maintenanceTimer, result: _result, ...record } = job
  return { ...record, position }
}

function validPersistedJob(value: unknown): value is PersistedJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const job = value as Record<string, unknown>
  return typeof job.id === 'string' && /^[0-9a-f-]{36}$/.test(job.id) && job.type === 'plan' &&
    typeof job.ownerHash === 'string' && /^[a-f0-9]{64}$/.test(job.ownerHash) &&
    (job.planVersion === undefined || job.planVersion === 0 || job.planVersion === 1) &&
    (job.sourceNameSha256 === undefined || (typeof job.sourceNameSha256 === 'string' && /^[a-f0-9]{64}$/.test(job.sourceNameSha256))) && (job.sourceType === undefined || job.sourceType === 'csv' || job.sourceType === 'text') &&
    (job.sourceSha256 === undefined || (typeof job.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(job.sourceSha256))) &&
    ['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(job.status)) &&
    (job.position === null || Number.isSafeInteger(job.position)) && typeof job.createdAt === 'string' && Number.isFinite(Date.parse(job.createdAt)) &&
    typeof job.updatedAt === 'string' && Number.isFinite(Date.parse(job.updatedAt)) &&
    (job.errorCode === undefined || (typeof job.errorCode === 'string' && /^[a-z0-9_-]{1,80}$/.test(job.errorCode)))
}

export type DemoPlanQueue = ReturnType<typeof createDemoPlanQueue>
export type DemoJobSnapshotWriter = (pathname: string, contents: string) => Promise<void>

async function writeSnapshotAtomically(pathname: string, contents: string): Promise<void> {
  const root = path.dirname(pathname)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const temporaryPath = path.join(root, `demo-jobs.${randomUUID()}.tmp`)
  let file
  try {
    file = await open(temporaryPath, 'wx', 0o600)
    await file.writeFile(contents, 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await rename(temporaryPath, pathname)
  } catch {
    if (file) await file.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw new Error('demo_job_storage_failed')
  }
}

export function createDemoPlanQueue(
  root = path.resolve(process.cwd(), '.ezagent'),
  planner: (input: unknown, signal?: AbortSignal) => Promise<PlanResponse> = planWorkflow,
  now: () => number = Date.now,
  limits: DemoQueueLimits = DEMO_PLAN_QUEUE,
  writeSnapshot: DemoJobSnapshotWriter = writeSnapshotAtomically,
) {
  const resolvedRoot = path.resolve(root)
  const queuePath = path.join(resolvedRoot, 'demo-jobs.json')
  let state = processQueues.get(resolvedRoot)
  if (!state) {
    state = makeState()
    processQueues.set(resolvedRoot, state)
  }
  const queueState = state as QueueState

  async function withAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queueState.admission
    let release: () => void = () => undefined
    queueState.admission = new Promise<void>((resolveAdmission) => { release = resolveAdmission })
    await previous
    try {
      return await operation()
    } finally {
      release()
      scheduleRetentionSweep()
    }
  }

  async function persist(): Promise<void> {
    const previous = queueState.persistQueue
    let release: () => void = () => undefined
    queueState.persistQueue = new Promise<void>((resolveQueue) => { release = resolveQueue })
    await previous
    try {
      const jobs = [...queueState.jobs.values()].map((job) => asPersisted(job, job.status === 'queued' ? positionOf(job.id) : null))
      await writeSnapshot(queuePath, JSON.stringify({ version: 1, jobs } satisfies PersistedJobs))
    } catch {
      queueState.storageFailed = true
      throw new Error('demo_job_storage_failed')
    } finally {
      release()
    }
  }

  function pruneExpired(): boolean {
    const cutoff = now() - limits.recordRetentionMs
    let changed = false
    for (const [id, job] of queueState.jobs) {
      if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'cancelling' && cutoff > Date.parse(job.updatedAt)) {
        queueState.jobs.delete(id)
        changed = true
      }
    }
    return changed
  }

  function scheduleRetentionSweep(): void {
    if (queueState.retentionTimer) clearTimeout(queueState.retentionTimer)
    queueState.retentionTimer = undefined
    const expiresAt = Math.min(...[...queueState.jobs.values()]
      .filter((job) => job.status !== 'queued' && job.status !== 'running' && job.status !== 'cancelling')
      .map((job) => Date.parse(job.updatedAt) + limits.recordRetentionMs))
    if (!Number.isFinite(expiresAt)) return
    queueState.retentionTimer = setTimeout(() => {
      if (pruneExpired()) void persist().catch(() => undefined)
      else scheduleRetentionSweep()
    }, Math.max(1, expiresAt - now()))
    queueState.retentionTimer.unref?.()
  }

  function failQueuedJobs(errorCode: string): void {
    const updatedAt = new Date(now()).toISOString()
    for (const job of queuedJobs()) {
      job.status = 'failed'
      job.errorCode = errorCode
      job.position = null
      job.updatedAt = updatedAt
      job.payload = null
    }
  }

  function queuedJobs(): LiveJob[] {
    return [...queueState.jobs.values()].filter((job) => job.status === 'queued').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  }

  function positionOf(id: string): number | null {
    const index = queuedJobs().findIndex((job) => job.id === id)
    return index < 0 ? null : index + 1
  }

  function view(job: LiveJob): DemoPlanJobView {
    const { id, status, createdAt, updatedAt, result, errorCode, planVersion, sourceNameSha256, sourceType, sourceSha256 } = job
    return {
      id,
      type: 'plan',
      status,
      position: status === 'queued' ? positionOf(job.id) : null,
      planVersion,
      sourceNameSha256,
      sourceType,
      sourceSha256,
      ...(result ? { result } : {}),
      ...(errorCode ? { errorCode } : {}),
      createdAt,
      updatedAt,
    }
  }

  async function initialize(): Promise<void> {
    if (queueState.init) return queueState.init
    queueState.init = (async () => {
      await mkdir(resolvedRoot, { recursive: true, mode: 0o700 })
      let content: string
      try {
        content = await readFile(queuePath, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          scheduleRetentionSweep()
          return
        }
        throw new Error('demo_job_storage_failed')
      }
      let parsed: PersistedJobs
      try {
        const value = JSON.parse(content) as PersistedJobs
        if (value.version !== 1 || !Array.isArray(value.jobs) || !value.jobs.every(validPersistedJob)) throw new Error('invalid')
        parsed = value
      } catch {
        throw new Error('demo_job_storage_failed')
      }
      const currentTime = now()
      const retained = parsed.jobs.filter((job) => currentTime - Date.parse(job.updatedAt) <= limits.recordRetentionMs)
      for (const stored of retained) {
        const legacy = stored.planVersion === undefined || stored.sourceSha256 === undefined || stored.sourceNameSha256 === undefined || stored.sourceType === undefined
        const old: PersistedJob = { ...stored, planVersion: legacy ? 0 : stored.planVersion, sourceNameSha256: stored.sourceNameSha256 ?? '0'.repeat(64), sourceType: stored.sourceType ?? 'text', sourceSha256: stored.sourceSha256 ?? '0'.repeat(64) }
        const status: DemoJobStatus = legacy || ['queued', 'running', 'cancelling', 'completed'].includes(old.status) ? 'interrupted' : old.status
        queueState.jobs.set(old.id, { ...old, status, errorCode: status === 'interrupted' ? 'process_restarted' : old.errorCode, ownerId: '', payload: null, position: null, updatedAt: status === 'interrupted' ? new Date(currentTime).toISOString() : old.updatedAt })
      }
      if (retained.some((job) => job.planVersion === undefined || job.sourceNameSha256 === undefined || job.sourceSha256 === undefined || ['queued', 'running', 'cancelling', 'completed'].includes(job.status)) || retained.length !== parsed.jobs.length) await persist()
      else scheduleRetentionSweep()
    })()
    return queueState.init
  }

  async function run(job: LiveJob): Promise<void> {
    queueState.runningId = job.id
    job.status = 'running'
    job.position = null
    job.updatedAt = new Date(now()).toISOString()
    const controller = new AbortController()
    job.controller = controller
    try {
      await persist()
    } catch {
      job.status = 'failed'
      job.errorCode = 'demo_job_storage_failed'
      job.payload = null
      job.updatedAt = new Date(now()).toISOString()
      delete job.controller
      queueState.runningId = null
      return
    }
    let timeoutFired = false
    job.timer = setTimeout(() => { timeoutFired = true; controller.abort(new DOMException('Demo planner timed out.', 'TimeoutError')) }, limits.jobTimeoutMs)
    job.maintenanceTimer = setInterval(() => {
      if (process.env.NODE_ENV === 'production' && (process.env.EZAGENT_DEMO_ENABLED !== '1' || process.env.EZAGENT_DEMO_RELEASE_APPROVED !== '1' || process.env.EZAGENT_DEMO_MAINTENANCE === '1')) {
        controller.abort(new DOMException('Demo service stopped.', 'AbortError'))
      }
    }, 1_000)
    try {
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Demo request cancelled.', 'AbortError')
      const result = await planner(job.payload, controller.signal)
      if (controller.signal.aborted) {
        job.status = 'cancelled'
        job.errorCode = 'request_cancelled'
      } else {
        job.result = result
        job.status = 'completed'
      }
    } catch (error) {
      if (timeoutFired) {
        job.status = 'failed'
        job.errorCode = 'planner_timeout'
      } else if (controller.signal.aborted) {
        job.status = 'cancelled'
        job.errorCode = 'request_cancelled'
      } else {
        const code = error instanceof PlannerError ? error.code :
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'planner_error'
        job.status = 'failed'
        job.errorCode = /^[a-z0-9_-]{1,80}$/.test(code) ? code : 'planner_error'
      }
    } finally {
      if (job.timer) clearTimeout(job.timer)
      if (job.maintenanceTimer) clearInterval(job.maintenanceTimer)
      delete job.timer
      delete job.maintenanceTimer
      delete job.controller
      job.updatedAt = new Date(now()).toISOString()
      job.payload = null
      queueState.runningId = null
      try {
        await persist()
      } catch {
        job.status = 'failed'
        job.errorCode = 'demo_job_storage_failed'
        delete job.result
      }
    }
  }

  async function pump(): Promise<void> {
    if (queueState.pumpActive) return
    queueState.pumpActive = true
    try {
      while (!queueState.runningId) {
        if (queueState.storageFailed) {
          failQueuedJobs('demo_job_storage_failed')
          return
        }
        const next = queuedJobs()[0]
        if (!next) return
        if (process.env.NODE_ENV === 'production' && (process.env.EZAGENT_DEMO_ENABLED !== '1' || process.env.EZAGENT_DEMO_RELEASE_APPROVED !== '1' || process.env.EZAGENT_DEMO_MAINTENANCE === '1')) {
          next.status = 'failed'
          next.errorCode = 'demo_maintenance'
          next.position = null
          next.updatedAt = new Date(now()).toISOString()
          next.payload = null
          try { await persist() } catch { failQueuedJobs('demo_job_storage_failed'); return }
          continue
        }
        if (now() - Date.parse(next.createdAt) > limits.queueTimeoutMs) {
          next.status = 'failed'
          next.errorCode = 'queue_timeout'
          next.position = null
          next.updatedAt = new Date(now()).toISOString()
          next.payload = null
          try { await persist() } catch { failQueuedJobs('demo_job_storage_failed'); return }
          continue
        }
        await run(next)
      }
    } finally {
      queueState.pumpActive = false
    }
  }

  return {
    async submit(ownerId: string, payload: unknown, beforeAccept?: () => Promise<void>): Promise<DemoPlanJobView> {
      const parsed = validatePlanRequest(payload)
      if (!parsed.ok) throw new Error('invalid_plan_request')
      await initialize()
      return withAdmission(async () => {
        if (queueState.storageFailed) throw new Error('demo_job_storage_failed')
        if (pruneExpired()) await persist()
        const waiting = queuedJobs().length
        if (waiting >= limits.maxPending) throw new Error('demo_queue_full')
        const timestamp = new Date(now()).toISOString()
        const job: LiveJob = {
          id: randomUUID(),
          type: 'plan',
          ownerHash: hash(ownerId),
          planVersion: 1,
          sourceNameSha256: hash(parsed.value.source.name),
          sourceType: parsed.value.source.type,
          sourceSha256: hash(parsed.value.source.content),
          ownerId,
          status: 'queued',
          position: waiting + 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          payload,
        }
        queueState.jobs.set(job.id, job)
        try {
          await persist()
          await beforeAccept?.()
        } catch (error) {
          queueState.jobs.delete(job.id)
          if (!queueState.storageFailed) await persist()
          throw error
        }
        void pump()
        return view(job)
      })
    },

    async get(jobId: string, ownerId: string): Promise<DemoPlanJobView | null> {
      await initialize()
      if (pruneExpired()) await persist()
      const job = queueState.jobs.get(jobId)
      if (!job || job.ownerHash !== hash(ownerId)) return null
      return view(job)
    },

    async cancel(jobId: string, ownerId: string): Promise<DemoPlanJobView | null> {
      await initialize()
      if (pruneExpired()) await persist()
      const job = queueState.jobs.get(jobId)
      if (!job || job.ownerHash !== hash(ownerId)) return null
      if (job.status === 'queued') {
        job.status = 'cancelled'
        job.position = null
        job.errorCode = 'request_cancelled'
        job.payload = null
      } else if (job.status === 'running') {
        job.status = 'cancelling'
        job.controller?.abort(new DOMException('Demo request cancelled.', 'AbortError'))
      } else return view(job)
      job.updatedAt = new Date(now()).toISOString()
      await persist()
      void pump()
      return view(job)
    },

    async status(): Promise<{ active: number; queued: number }> {
      await initialize()
      if (pruneExpired()) await persist()
      return { active: queueState.runningId ? 1 : 0, queued: queuedJobs().length }
    },

    async flush(): Promise<void> {
      await initialize()
      while (queueState.pumpActive) await new Promise((resolve) => setTimeout(resolve, 5))
      await queueState.persistQueue
    },
  }
}

const defaultQueueGlobalV2 = globalThis as typeof globalThis & { __ezagentDemoPlanQueueV2?: DemoPlanQueue }
export const demoPlanQueue = defaultQueueGlobalV2.__ezagentDemoPlanQueueV2 ??= createDemoPlanQueue()
