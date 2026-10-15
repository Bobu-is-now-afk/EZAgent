import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  DocumentDraft,
  DocumentSample,
  DocumentStoreState,
  HostedControlState,
  DraftSuggestion,
  FieldProvenance,
  OrderRecord,
  OrderSnapshot,
  Party,
} from './contracts'
import type { ValidatedDraftPatch, ValidatedOrderInput } from './validation'
import { computeDocumentTotals } from './money'
import { reviewableFieldPaths, validateDraftForReview } from './validation'

const FILE_NAME = 'snapshot.json'
const SNAPSHOT_LIMIT = 10 * 1024 * 1024
const MAX_ORDERS = 250
const MAX_DRAFTS = 250
const MAX_SUGGESTIONS = 1000
const MAX_SAMPLES = 1000
const MAX_REVISIONS = 100

type Registry = { queues: Map<string, Promise<void>> }
const globalWithRegistry = globalThis as typeof globalThis & { __ezagentDocumentStoreRegistryV1?: Registry }
const registry = globalWithRegistry.__ezagentDocumentStoreRegistryV1 ??= { queues: new Map() }

type LockOwner = { pid: number; token: string; createdAt: number }
const LOCK_WAIT_MS = 15_000
const LOCK_POLL_MS = 25
const LOCK_INITIALIZE_GRACE_MS = 1_000

function lockPath(root: string): string {
  return resolve(root, '.snapshot.lock')
}

function recoveryLockPath(root: string): string {
  return resolve(root, '.snapshot.lock-recovery')
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readLockOwner(path: string): Promise<{ owner: LockOwner | null; modifiedAt: number } | null> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) fail('unsafe_storage_lock', 'Document storage lock is not a regular file.', 500)
    if (info.size > 1024) fail('corrupt_storage_lock', 'Document storage lock is invalid.', 500)
    let owner: LockOwner | null = null
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (isRecord(parsed) && Number.isSafeInteger(parsed.pid) && typeof parsed.token === 'string' && Number.isSafeInteger(parsed.createdAt)) {
        owner = { pid: parsed.pid as number, token: parsed.token, createdAt: parsed.createdAt as number }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    }
    return { owner, modifiedAt: info.mtimeMs }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof DocumentStoreError) throw error
    fail('store_io', 'Document storage lock could not be read.', 500)
  }
}

async function releaseOwnedLock(path: string, handle: Awaited<ReturnType<typeof open>>, token: string): Promise<void> {
  try {
    const current = await readLockOwner(path)
    if (current?.owner?.token === token && current.owner.pid === process.pid) await unlink(path)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function removeDeadLock(root: string, path: string): Promise<boolean> {
  const observed = await readLockOwner(path)
  if (!observed) return true
  if (!observed.owner && Date.now() - observed.modifiedAt <= LOCK_INITIALIZE_GRACE_MS) return false
  if (observed.owner && processIsAlive(observed.owner.pid)) return false

  let recoveryHandle: Awaited<ReturnType<typeof open>>
  const recoveryToken = randomUUID()
  try {
    recoveryHandle = await open(recoveryLockPath(root), 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const recovery = await readLockOwner(recoveryLockPath(root))
      if (recovery && ((recovery.owner && !processIsAlive(recovery.owner.pid)) ||
          (!recovery.owner && Date.now() - recovery.modifiedAt > LOCK_INITIALIZE_GRACE_MS))) {
        fail('stale_lock_recovery', 'A previous storage lock recovery was interrupted; manual local recovery is required.', 503)
      }
      return false
    }
    fail('store_io', 'Document storage lock recovery could not start.', 500)
  }
  try {
    await recoveryHandle.writeFile(JSON.stringify({ pid: process.pid, token: recoveryToken, createdAt: Date.now() }), 'utf8')
    await recoveryHandle.sync()
  } catch {
    await unlink(recoveryLockPath(root)).catch(() => undefined)
    await recoveryHandle.close().catch(() => undefined)
    fail('store_io', 'Document storage lock recovery could not start.', 500)
  }

  try {
    const current = await readLockOwner(path)
    const sameDeadOwner = observed.owner && current?.owner?.token === observed.owner.token && !processIsAlive(current.owner.pid)
    const sameAbandonedInitialization = !observed.owner && current && !current.owner &&
      current.modifiedAt === observed.modifiedAt && Date.now() - current.modifiedAt > LOCK_INITIALIZE_GRACE_MS
    if (sameDeadOwner || sameAbandonedInitialization) {
      await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      return true
    }
    return current === null
  } finally {
    try {
      const recovery = await readLockOwner(recoveryLockPath(root))
      if (recovery?.owner?.token === recoveryToken && recovery.owner.pid === process.pid) await unlink(recoveryLockPath(root))
    } finally {
      await recoveryHandle.close().catch(() => undefined)
    }
  }
}

async function acquireFileLock(root: string): Promise<() => Promise<void>> {
  const path = lockPath(root)
  const deadline = Date.now() + LOCK_WAIT_MS
  while (Date.now() < deadline) {
    const token = randomUUID()
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(path, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fail('store_io', 'Document storage lock could not be acquired.', 500)
      await removeDeadLock(root, path)
      await new Promise((resolveWait) => setTimeout(resolveWait, LOCK_POLL_MS))
      continue
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }), 'utf8')
      await handle.sync()
      return () => releaseOwnedLock(path, handle, token)
    } catch {
      await unlink(path).catch(() => undefined)
      await handle.close().catch(() => undefined)
      fail('store_io', 'Document storage lock could not be initialized.', 500)
    }
  }
  fail('store_busy', 'Document data is busy in another local process. Retry shortly.', 503)
}

function withWriter<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = registry.queues.get(root) ?? Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const queued = previous.then(() => gate)
  registry.queues.set(root, queued)
  return previous.then(async () => {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const unlock = await acquireFileLock(root)
    try { return await operation() } finally { await unlock() }
  }).finally(() => {
    release()
    if (registry.queues.get(root) === queued) registry.queues.delete(root)
  })
}

export class DocumentStoreError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'DocumentStoreError'
    this.code = code
    this.status = status
  }
}

export type StoreResult<T> = { value: T; created?: boolean }

function fail(code: string, message: string, status = 400): never {
  throw new DocumentStoreError(code, message, status)
}

function emptyState(): DocumentStoreState {
  return { schemaVersion: 1, orders: [], drafts: [], suggestions: [], samples: [], sampleSequence: 0, sampleIdempotency: {} }
}

export function emptyHostedControlState(now = Date.now()): HostedControlState {
  return {
    inviteOwners: [], sessions: [],
    requestWindow: { minute: Math.floor(now / 60_000), globalCount: 0, byOwner: {} },
    dailySuggestions: { dayUTC: new Date(now).toISOString().slice(0, 10), byOwner: {} },
    activeSuggestions: [], queuedSuggestions: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHostedControlState(value: unknown): value is HostedControlState {
  if (!isRecord(value) || !Array.isArray(value.inviteOwners) || value.inviteOwners.length > 10 ||
      !Array.isArray(value.sessions) || value.sessions.length > 10 || !isRecord(value.requestWindow) ||
      !Number.isSafeInteger(value.requestWindow.minute) || !Number.isSafeInteger(value.requestWindow.globalCount) ||
      (value.requestWindow.globalCount as number) < 0 || !isRecord(value.requestWindow.byOwner) ||
      !isRecord(value.dailySuggestions) || typeof value.dailySuggestions.dayUTC !== 'string' ||
      !isRecord(value.dailySuggestions.byOwner) || !Array.isArray(value.activeSuggestions) || value.activeSuggestions.length > 1 ||
      !Array.isArray(value.queuedSuggestions) || value.queuedSuggestions.length > 2) return false
  if (!value.inviteOwners.every((item) => isRecord(item) && typeof item.inviteId === 'string' &&
      /^[a-zA-Z0-9_-]{1,64}$/.test(item.inviteId) && isUuid(item.ownerId) && Number.isSafeInteger(item.createdAt))) return false
  if (!value.sessions.every((item) => isRecord(item) && isUuid(item.nonce) && isUuid(item.ownerId) &&
      Number.isSafeInteger(item.expiresAt) && (item.revokedAt === null || Number.isSafeInteger(item.revokedAt)))) return false
  const isOwnerCounts = (counts: Record<string, unknown>) => Object.entries(counts).length <= 10 &&
    Object.entries(counts).every(([owner, count]) => isUuid(owner) && Number.isSafeInteger(count) && (count as number) >= 0)
  if (!isOwnerCounts(value.requestWindow.byOwner) || !isOwnerCounts(value.dailySuggestions.byOwner)) return false
  const isLease = (item: unknown) => isRecord(item) && isUuid(item.id) && isUuid(item.ownerId) &&
    Number.isSafeInteger(item.pid) && (item.pid as number) > 0 && Number.isSafeInteger(item.startedAt ?? item.enqueuedAt)
  return value.activeSuggestions.every(isLease) && value.queuedSuggestions.every(isLease)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isProvenance(value: unknown): value is FieldProvenance {
  return isRecord(value) && ['order', 'user', 'ai_suggestion'].includes(String(value.source)) &&
    typeof value.confirmed === 'boolean' &&
    (value.sourceId === undefined || typeof value.sourceId === 'string') &&
    (value.sourceRevision === undefined || Number.isSafeInteger(value.sourceRevision)) &&
    (value.suggestionId === undefined || typeof value.suggestionId === 'string')
}

function isParty(value: unknown): value is Party {
  return isRecord(value) && ['name', 'address', 'contact'].every((key) => value[key] === null || typeof value[key] === 'string')
}

function isOrderSnapshot(value: unknown): value is OrderSnapshot {
  return isRecord(value) && typeof value.id === 'string' && Number.isSafeInteger(value.revision) &&
    (value.status === 'active' || value.status === 'archived') && isParty(value.buyer) &&
    (value.currency === null || value.currency === 'HKD' || value.currency === 'TWD') &&
    Array.isArray(value.items) && value.items.every((item) => isRecord(item) && typeof item.id === 'string' &&
      (item.name === null || typeof item.name === 'string') && (item.description === null || typeof item.description === 'string') &&
      (item.quantity === null || (Number.isSafeInteger(item.quantity) && (item.quantity as number) > 0)) &&
      (item.unitPriceMinor === null || (Number.isSafeInteger(item.unitPriceMinor) && (item.unitPriceMinor as number) >= 0))) &&
    (value.agreedDate === null || typeof value.agreedDate === 'string') &&
    (value.termsText === null || typeof value.termsText === 'string') && isRecord(value.source) &&
    value.source.kind === 'manual' && isRecord(value.provenance) && Object.values(value.provenance).every(isProvenance) &&
    isDate(value.createdAt) && isDate(value.updatedAt)
}

function isDraft(value: unknown): value is DocumentDraft {
  return isRecord(value) && typeof value.id === 'string' && Number.isSafeInteger(value.revision) &&
    ['quotation', 'invoice', 'receipt'].includes(String(value.type)) &&
    ['draft', 'reviewed', 'sample_created'].includes(String(value.status)) &&
    (value.sourceOrder === null || (isRecord(value.sourceOrder) && typeof value.sourceOrder.id === 'string' && Number.isSafeInteger(value.sourceOrder.revision))) &&
    value.linkedDocumentId === null && value.sellerProfileRef === null && isParty(value.buyer) &&
    (value.currency === null || value.currency === 'HKD' || value.currency === 'TWD') &&
    Array.isArray(value.items) && value.items.every((item) => isRecord(item) && typeof item.id === 'string' &&
      (item.name === null || typeof item.name === 'string') && (item.description === null || typeof item.description === 'string') &&
      (item.quantity === null || (Number.isSafeInteger(item.quantity) && (item.quantity as number) > 0)) &&
      (item.unitPriceMinor === null || (Number.isSafeInteger(item.unitPriceMinor) && (item.unitPriceMinor as number) >= 0))) &&
    ['termsText', 'issueDate', 'dueDate', 'validUntil', 'paymentDate', 'paymentMethod'].every((key) => value[key] === null || typeof value[key] === 'string') &&
    (value.paymentAmountMinor === null || (Number.isSafeInteger(value.paymentAmountMinor) && (value.paymentAmountMinor as number) >= 0)) &&
    (value.taxMode === null || ['none', 'included', 'excluded'].includes(String(value.taxMode))) &&
    (value.taxRateBasisPoints === null || (Number.isSafeInteger(value.taxRateBasisPoints) && (value.taxRateBasisPoints as number) >= 0 && (value.taxRateBasisPoints as number) <= 10_000)) &&
    isRecord(value.provenance) && Object.values(value.provenance).every(isProvenance) &&
    (value.reviewedRevision === null || Number.isSafeInteger(value.reviewedRevision)) &&
    (value.reviewDigest === null || /^[a-f0-9]{64}$/.test(String(value.reviewDigest))) &&
    (value.reviewedAt === null || isDate(value.reviewedAt)) && (value.sampleId === null || typeof value.sampleId === 'string') &&
    isDate(value.createdAt) && isDate(value.updatedAt)
}

function isSuggestion(value: unknown): value is DraftSuggestion {
  return isRecord(value) && typeof value.id === 'string' && typeof value.draftId === 'string' && Number.isSafeInteger(value.baseRevision) &&
    Array.isArray(value.fields) && value.fields.length <= 8 && value.fields.every((field) => isRecord(field) &&
      ['termsText', 'items[].description'].includes(String(field.path)) && typeof field.value === 'string' && typeof field.sourceExcerpt === 'string') &&
    Array.isArray(value.missingFields) && value.missingFields.every((item) => typeof item === 'string') && isDate(value.createdAt)
}

function isSample(value: unknown): value is DocumentSample {
  return isRecord(value) && typeof value.id === 'string' && typeof value.draftId === 'string' &&
    Number.isSafeInteger(value.draftRevision) && typeof value.sampleNumber === 'string' &&
    value.status === 'SAMPLE / NOT FOR PAYMENT' && ['quotation', 'invoice', 'receipt'].includes(String(value.type)) &&
    isDraft(value.snapshot) && isRecord(value.totals) &&
    (value.totals.subtotalMinor === null || Number.isSafeInteger(value.totals.subtotalMinor)) &&
    (value.totals.taxMinor === null || Number.isSafeInteger(value.totals.taxMinor)) &&
    (value.totals.totalMinor === null || Number.isSafeInteger(value.totals.totalMinor)) &&
    (value.totals.currency === null || value.totals.currency === 'HKD' || value.totals.currency === 'TWD') &&
    /^[a-f0-9]{64}$/.test(String(value.digest)) && isDate(value.createdAt)
}

function isState(value: unknown): value is DocumentStoreState {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.orders) || !Array.isArray(value.drafts) ||
      !Array.isArray(value.suggestions) || !Array.isArray(value.samples) || !Number.isSafeInteger(value.sampleSequence) ||
      (value.sampleSequence as number) < 0 || !isRecord(value.sampleIdempotency)) return false
  if ('hostedControl' in value && !isHostedControlState(value.hostedControl)) return false
  if (value.orders.length > MAX_ORDERS || value.drafts.length > MAX_DRAFTS || value.suggestions.length > MAX_SUGGESTIONS || value.samples.length > MAX_SAMPLES) return false
  if (!value.orders.every((record) => isRecord(record) && typeof record.id === 'string' && Number.isSafeInteger(record.currentRevision) &&
      Array.isArray(record.revisions) && record.revisions.length > 0 && record.revisions.length <= MAX_REVISIONS &&
      record.revisions.every(isOrderSnapshot) && record.revisions.at(-1)?.revision === record.currentRevision)) return false
  if (!value.drafts.every(isDraft) || !value.suggestions.every(isSuggestion) || !value.samples.every(isSample)) return false
  for (const entry of Object.values(value.sampleIdempotency)) {
    if (!isRecord(entry) || !/^[a-f0-9]{64}$/.test(String(entry.requestDigest)) || typeof entry.sampleId !== 'string') return false
  }
  return true
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  return value
}

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex')
}

export function draftReviewDigest(draft: DocumentDraft): string {
  return digest({
    id: draft.id,
    revision: draft.revision,
    type: draft.type,
    sourceOrder: draft.sourceOrder,
    linkedDocumentId: draft.linkedDocumentId,
    sellerProfileRef: draft.sellerProfileRef,
    buyer: draft.buyer,
    currency: draft.currency,
    items: draft.items,
    termsText: draft.termsText,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    validUntil: draft.validUntil,
    paymentDate: draft.paymentDate,
    paymentAmountMinor: draft.paymentAmountMinor,
    paymentMethod: draft.paymentMethod,
    taxMode: draft.taxMode,
    taxRateBasisPoints: draft.taxRateBasisPoints,
    provenance: draft.provenance,
  })
}

function provenance(source: FieldProvenance['source'], confirmed: boolean, extras: Partial<FieldProvenance> = {}): FieldProvenance {
  return { source, confirmed, ...extras }
}

function orderProvenance(input: ValidatedOrderInput): OrderSnapshot['provenance'] {
  const map: OrderSnapshot['provenance'] = {
    'buyer.name': provenance('user', input.buyer.name !== null),
    'buyer.address': provenance('user', input.buyer.address !== null),
    'buyer.contact': provenance('user', input.buyer.contact !== null),
    currency: provenance('user', input.currency !== null),
    agreedDate: provenance('user', input.agreedDate !== null),
    termsText: provenance('user', input.termsText !== null),
  }
  input.items.forEach((item, index) => {
    map[`items[${index}].name`] = provenance('user', item.name !== null)
    map[`items[${index}].description`] = provenance('user', item.description !== null)
    map[`items[${index}].quantity`] = provenance('user', item.quantity !== null)
    map[`items[${index}].unitPriceMinor`] = provenance('user', item.unitPriceMinor !== null)
  })
  return map
}

function draftProvenanceFromOrder(order: OrderSnapshot, items: OrderSnapshot['items']): DocumentDraft['provenance'] {
  const map: DocumentDraft['provenance'] = {}
  const copy = (field: string) => {
    const original = order.provenance[field]
    map[field] = provenance('order', original?.confirmed ?? false, { sourceId: order.id, sourceRevision: order.revision })
  }
  for (const field of ['buyer.name', 'buyer.address', 'buyer.contact', 'currency', 'termsText']) copy(field)
  items.forEach((_item, index) => {
    for (const field of ['name', 'description', 'quantity', 'unitPriceMinor']) copy(`items[${index}].${field}`)
  })
  for (const field of ['issueDate', 'dueDate', 'validUntil', 'paymentDate', 'paymentAmountMinor', 'paymentMethod', 'taxMode', 'taxRateBasisPoints']) {
    map[field] = provenance('user', false)
  }
  return map
}

function makeDraft(type: DocumentDraft['type'], source: OrderSnapshot | null): DocumentDraft {
  const now = new Date().toISOString()
  const items = source?.items.map((item) => ({ ...item, id: randomUUID() })) ?? []
  const draft: DocumentDraft = {
    id: randomUUID(), revision: 1, type, status: 'draft',
    sourceOrder: source ? { id: source.id, revision: source.revision } : null,
    linkedDocumentId: null, sellerProfileRef: null,
    buyer: source ? structuredClone(source.buyer) : { name: null, address: null, contact: null },
    currency: source?.currency ?? null,
    items,
    termsText: source?.termsText ?? null,
    issueDate: null, dueDate: null, validUntil: null,
    paymentDate: null, paymentAmountMinor: null, paymentMethod: null,
    taxMode: null, taxRateBasisPoints: null,
    provenance: source ? draftProvenanceFromOrder(source, items) : {
      'buyer.name': provenance('user', false), 'buyer.address': provenance('user', false), 'buyer.contact': provenance('user', false),
      currency: provenance('user', false), termsText: provenance('user', false), issueDate: provenance('user', false),
      dueDate: provenance('user', false), validUntil: provenance('user', false), paymentDate: provenance('user', false),
      paymentAmountMinor: provenance('user', false), paymentMethod: provenance('user', false), taxMode: provenance('user', false),
      taxRateBasisPoints: provenance('user', false),
    },
    reviewedRevision: null, reviewDigest: null, reviewedAt: null, sampleId: null,
    createdAt: now, updatedAt: now,
  }
  if (!source) draft.items = []
  return draft
}

function getOrderRecord(state: DocumentStoreState, id: string): OrderRecord | null {
  return state.orders.find((order) => order.id === id) ?? null
}

function currentOrder(record: OrderRecord): OrderSnapshot {
  return record.revisions[record.revisions.length - 1]
}

function findOrderVersion(record: OrderRecord, revision: number): OrderSnapshot | null {
  return record.revisions.find((snapshot) => snapshot.revision === revision) ?? null
}

function applyOrderInput(id: string, revision: number, createdAt: string, input: ValidatedOrderInput, status: OrderSnapshot['status'] = 'active'): OrderSnapshot {
  return {
    id, revision, status,
    buyer: structuredClone(input.buyer), currency: input.currency,
    items: input.items.map((item) => ({ ...item, id: randomUUID() })),
    agreedDate: input.agreedDate, termsText: input.termsText,
    source: { kind: 'manual', referenceId: input.sourceReferenceId, referenceVersion: input.sourceReferenceVersion },
    provenance: orderProvenance(input), createdAt, updatedAt: new Date().toISOString(),
  }
}

function copyDraft(draft: DocumentDraft): DocumentDraft {
  return structuredClone(draft)
}

export class DocumentStore {
  private readonly root: string
  private readonly snapshotPath: string

  constructor(root = resolve(process.cwd(), '.ezagent', 'documents')) {
    this.root = resolve(root)
    this.snapshotPath = resolve(this.root, FILE_NAME)
  }

  async initialize(): Promise<void> {
    await withWriter(this.root, async () => {
      try {
        const parent = resolve(this.root, '..')
        try {
          const parentInfo = await lstat(parent)
          if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) fail('unsafe_storage_path', 'Document storage parent is not a private directory.', 500)
        } catch (error) {
          if (!isRecord(error) || error.code !== 'ENOENT') throw error
        }
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        const info = await lstat(this.root)
        if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe_storage_path', 'Document storage path is not a private directory.', 500)
        await chmod(this.root, 0o700)
        const state = await this.readState()
        if (!state) await this.writeState(emptyState())
      } catch (error) {
        if (error instanceof DocumentStoreError) throw error
        fail('store_io', 'Document storage could not be initialized.', 500)
      }
    })
  }

  async listOrders(): Promise<OrderSnapshot[]> {
    const state = await this.requireState()
    return state.orders.map(currentOrder).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getOrder(id: string, revision?: number): Promise<{ order: OrderSnapshot; history: OrderSnapshot[] }> {
    const state = await this.requireState()
    const record = getOrderRecord(state, id)
    if (!record) fail('order_not_found', 'Order does not exist.', 404)
    const selected = revision === undefined ? currentOrder(record) : findOrderVersion(record, revision)
    if (!selected) fail('order_revision_not_found', 'Order revision does not exist.', 404)
    return { order: selected, history: record.revisions.map((item) => structuredClone(item)) }
  }

  async createOrder(input: ValidatedOrderInput): Promise<OrderSnapshot> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      if (state.orders.length >= MAX_ORDERS) fail('order_limit', 'The local order limit has been reached.', 409)
      const id = randomUUID()
      const snapshot = applyOrderInput(id, 1, new Date().toISOString(), input)
      state.orders.push({ id, currentRevision: 1, revisions: [snapshot] })
      await this.writeState(state)
      return snapshot
    })
  }

  async updateOrder(id: string, expectedRevision: number, input: ValidatedOrderInput): Promise<OrderSnapshot> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const record = getOrderRecord(state, id)
      if (!record) fail('order_not_found', 'Order does not exist.', 404)
      const prior = currentOrder(record)
      if (prior.revision !== expectedRevision) fail('revision_conflict', 'Order changed since it was loaded.', 409)
      if (prior.status === 'archived') fail('order_archived', 'Archived orders cannot be edited.', 409)
      const currencyChangedWithPrices = prior.currency !== input.currency && prior.items.some((item) => item.unitPriceMinor !== null) && input.items.some((item) => item.unitPriceMinor !== null)
      if (currencyChangedWithPrices) fail('currency_change_requires_reprice', 'Clear existing prices before changing currency, then enter prices again.', 409)
      if (record.revisions.length >= MAX_REVISIONS) fail('order_revision_limit', 'Order revision limit reached.', 409)
      const snapshot = applyOrderInput(id, prior.revision + 1, prior.createdAt, input)
      record.currentRevision = snapshot.revision
      record.revisions.push(snapshot)
      await this.writeState(state)
      return snapshot
    })
  }

  async deleteOrArchiveOrder(id: string, expectedRevision: number): Promise<{ deleted: boolean; order: OrderSnapshot | null }> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const record = getOrderRecord(state, id)
      if (!record) fail('order_not_found', 'Order does not exist.', 404)
      const prior = currentOrder(record)
      if (prior.revision !== expectedRevision) fail('revision_conflict', 'Order changed since it was loaded.', 409)
      const referenced = state.drafts.some((draft) => draft.sourceOrder?.id === id) ||
        state.samples.some((sample) => sample.snapshot.sourceOrder?.id === id)
      if (!referenced) {
        state.orders = state.orders.filter((order) => order.id !== id)
        await this.writeState(state)
        return { deleted: true, order: null }
      }
      if (record.revisions.length >= MAX_REVISIONS) fail('order_revision_limit', 'Order revision limit reached.', 409)
      const archived: OrderSnapshot = { ...prior, revision: prior.revision + 1, status: 'archived', updatedAt: new Date().toISOString() }
      record.revisions.push(archived)
      record.currentRevision = archived.revision
      await this.writeState(state)
      return { deleted: false, order: archived }
    })
  }

  async listDrafts(): Promise<DocumentDraft[]> {
    const state = await this.requireState()
    return state.drafts.map(copyDraft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getDraft(id: string): Promise<{ draft: DocumentDraft; totals: ReturnType<typeof computeDocumentTotals>; sourceOrderCurrentRevision: number | null }> {
    const state = await this.requireState()
    const draft = state.drafts.find((item) => item.id === id)
    if (!draft) fail('draft_not_found', 'Draft does not exist.', 404)
    const order = draft.sourceOrder ? getOrderRecord(state, draft.sourceOrder.id) : null
    return {
      draft: copyDraft(draft), totals: computeDocumentTotals(draft),
      sourceOrderCurrentRevision: order ? order.currentRevision : null,
    }
  }

  async createDraft(type: DocumentDraft['type'], sourceRef: { id: string; revision: number } | null): Promise<DocumentDraft> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      if (state.drafts.length >= MAX_DRAFTS) fail('draft_limit', 'The local draft limit has been reached.', 409)
      let source: OrderSnapshot | null = null
      if (sourceRef) {
        const record = getOrderRecord(state, sourceRef.id)
        if (!record) fail('order_not_found', 'Order does not exist.', 404)
        source = findOrderVersion(record, sourceRef.revision)
        if (!source) fail('order_revision_not_found', 'Order revision does not exist.', 404)
        if (source.status === 'archived') fail('order_archived', 'Archived orders cannot create new drafts.', 409)
      }
      const draft = makeDraft(type, source)
      state.drafts.push(draft)
      await this.writeState(state)
      return copyDraft(draft)
    })
  }

  async patchDraft(id: string, expectedRevision: number, patch: ValidatedDraftPatch): Promise<DocumentDraft> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const index = state.drafts.findIndex((item) => item.id === id)
      if (index < 0) fail('draft_not_found', 'Draft does not exist.', 404)
      const current = state.drafts[index]
      if (current.revision !== expectedRevision) fail('revision_conflict', 'Draft changed since it was loaded.', 409)
      const newCurrency = patch.currency === undefined ? current.currency : patch.currency
      if (newCurrency !== current.currency && current.items.some((item) => item.unitPriceMinor !== null) &&
          (!patch.items || patch.items.some((item) => item.unitPriceMinor !== null))) {
        fail('currency_change_requires_reprice', 'Clear existing prices before changing currency, then enter prices again.', 409)
      }
      const next = copyDraft(current)
      const mark = (path: string) => { next.provenance[path] = provenance('user', true) }
      if (patch.buyer) {
        const previousBuyer = current.buyer
        next.buyer = structuredClone(patch.buyer)
        for (const key of ['name', 'address', 'contact'] as const) {
          if (patch.buyer[key] !== previousBuyer[key]) mark(`buyer.${key}`)
        }
      }
      if (patch.currency !== undefined) {
        next.currency = patch.currency
        if (patch.currency !== current.currency) mark('currency')
      }
      if (patch.items) {
        const priorById = new Map(current.items.map((item, index) => [item.id, { item, index }]))
        next.items = patch.items.map((item) => {
          const previous = item.id ? priorById.get(item.id) : undefined
          const itemId = previous ? item.id as string : randomUUID()
          return { id: itemId, name: item.name, description: item.description, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor }
        })
        for (const key of Object.keys(next.provenance)) if (/^items\[\d+\]\./.test(key)) delete next.provenance[key]
        next.items.forEach((item, index) => {
          const previous = patch.items?.[index]?.id ? priorById.get(patch.items[index].id as string) : undefined
          for (const field of ['name', 'description', 'quantity', 'unitPriceMinor'] as const) {
            const path = `items[${index}].${field}`
            const value = item[field]
            if (previous && previous.item[field] === value && current.provenance[`items[${previous.index}].${field}`]) {
              next.provenance[path] = structuredClone(current.provenance[`items[${previous.index}].${field}`])
            } else {
              next.provenance[path] = provenance('user', value !== null)
            }
          }
        })
      }
      const scalarFields = ['termsText', 'issueDate', 'dueDate', 'validUntil', 'paymentDate', 'paymentAmountMinor', 'paymentMethod', 'taxMode', 'taxRateBasisPoints'] as const
      for (const field of scalarFields) {
        if (!(field in patch)) continue
        const value = (patch as Record<string, unknown>)[field]
        const priorValue = (current as unknown as Record<string, unknown>)[field]
        ;(next as unknown as Record<string, unknown>)[field] = value
        if (value !== priorValue) mark(field)
      }
      next.revision += 1
      next.status = 'draft'
      next.reviewedRevision = null
      next.reviewDigest = null
      next.reviewedAt = null
      next.sampleId = null
      next.updatedAt = new Date().toISOString()
      state.drafts[index] = next
      state.suggestions = state.suggestions.filter((suggestion) => suggestion.draftId !== id || suggestion.baseRevision === next.revision)
      await this.writeState(state)
      return copyDraft(next)
    })
  }

  async deleteDraft(id: string, expectedRevision: number): Promise<void> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const draft = state.drafts.find((item) => item.id === id)
      if (!draft) fail('draft_not_found', 'Draft does not exist.', 404)
      if (draft.revision !== expectedRevision) fail('revision_conflict', 'Draft changed since it was loaded.', 409)
      state.drafts = state.drafts.filter((item) => item.id !== id)
      state.suggestions = state.suggestions.filter((suggestion) => suggestion.draftId !== id)
      await this.writeState(state)
    })
  }

  async addSuggestion(suggestion: Omit<DraftSuggestion, 'id' | 'createdAt'>): Promise<DraftSuggestion> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const draft = state.drafts.find((item) => item.id === suggestion.draftId)
      if (!draft) fail('draft_not_found', 'Draft does not exist.', 404)
      if (draft.revision !== suggestion.baseRevision) fail('revision_conflict', 'Draft changed while the suggestion was generated.', 409)
      if (state.suggestions.length >= MAX_SUGGESTIONS) state.suggestions.shift()
      const created: DraftSuggestion = { ...structuredClone(suggestion), id: randomUUID(), createdAt: new Date().toISOString() }
      state.suggestions.push(created)
      await this.writeState(state)
      return created
    })
  }

  async applySuggestion(draftId: string, expectedRevision: number, suggestionId: string, fieldIndexes: number[]): Promise<DocumentDraft> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const draftIndex = state.drafts.findIndex((item) => item.id === draftId)
      if (draftIndex < 0) fail('draft_not_found', 'Draft does not exist.', 404)
      const draft = state.drafts[draftIndex]
      if (draft.revision !== expectedRevision) fail('revision_conflict', 'Draft changed since the suggestion was generated.', 409)
      const suggestion = state.suggestions.find((item) => item.id === suggestionId && item.draftId === draftId)
      if (!suggestion) fail('suggestion_not_found', 'Suggestion does not exist.', 404)
      if (suggestion.baseRevision !== draft.revision) fail('suggestion_stale', 'Suggestion belongs to an older draft revision.', 409)
      if (!Array.isArray(fieldIndexes) || fieldIndexes.length < 1 || fieldIndexes.length > suggestion.fields.length ||
          new Set(fieldIndexes).size !== fieldIndexes.length || fieldIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= suggestion.fields.length)) {
        fail('suggestion_field_not_found', 'Select one or more fields from this suggestion.', 400)
      }
      const selected = fieldIndexes.map((index) => suggestion.fields[index])
      const next = copyDraft(draft)
      if (selected.filter((field) => field.path === 'termsText').length > 1) fail('duplicate_suggestion_path', 'A terms field can only be applied once.', 400)
      for (const field of selected) {
      if (field.path === 'termsText') {
          next.termsText = field.value
          next.provenance.termsText = provenance('ai_suggestion', true, { suggestionId })
        } else {
          const itemIndex = next.items.length
          next.items.push({ id: randomUUID(), name: null, description: field.value, quantity: null, unitPriceMinor: null })
          next.provenance[`items[${itemIndex}].description`] = provenance('ai_suggestion', true, { suggestionId })
          next.provenance[`items[${itemIndex}].name`] = provenance('user', false)
          next.provenance[`items[${itemIndex}].quantity`] = provenance('user', false)
          next.provenance[`items[${itemIndex}].unitPriceMinor`] = provenance('user', false)
        }
      }
      next.revision += 1
      next.status = 'draft'
      next.reviewedRevision = null
      next.reviewDigest = null
      next.reviewedAt = null
      next.sampleId = null
      next.updatedAt = new Date().toISOString()
      state.drafts[draftIndex] = next
      state.suggestions = state.suggestions.filter((item) => item.id !== suggestionId)
      await this.writeState(state)
      return copyDraft(next)
    })
  }

  async reviewDraft(id: string, expectedRevision: number, confirmedPaths: string[]): Promise<{ draft: DocumentDraft; totals: ReturnType<typeof computeDocumentTotals>; digest: string }> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const draftIndex = state.drafts.findIndex((item) => item.id === id)
      if (draftIndex < 0) fail('draft_not_found', 'Draft does not exist.', 404)
      const draft = state.drafts[draftIndex]
      if (draft.revision !== expectedRevision) fail('revision_conflict', 'Draft changed before review.', 409)
      if (draft.sourceOrder) {
        const source = getOrderRecord(state, draft.sourceOrder.id)
        if (!source) fail('source_order_missing', 'The source order is no longer available.', 409)
        if (source.currentRevision !== draft.sourceOrder.revision) fail('source_order_changed', 'The source order has a newer revision. Create a new draft from the updated order before review.', 409)
      }
      const missing = validateDraftForReview(draft)
      if (missing.length) fail('draft_incomplete', `Missing required fields: ${missing.join(', ')}.`, 409)
      const paths = reviewableFieldPaths(draft)
      const requested = [...new Set(confirmedPaths)].sort()
      if (requested.length !== paths.length || requested.some((path, index) => path !== paths[index])) {
        fail('review_confirmation_mismatch', 'Confirm each populated field in the current draft.', 409)
      }
      const unconfirmed = paths.filter((path) => !draft.provenance[path]?.confirmed)
      if (unconfirmed.length) fail('unconfirmed_fields', `Fields need human confirmation: ${unconfirmed.join(', ')}.`, 409)
      const totals = computeDocumentTotals(draft)
      if (totals.totalMinor === null) fail('invalid_totals', 'Document totals are incomplete or invalid.', 409)
      const next = copyDraft(draft)
      next.status = 'reviewed'
      next.reviewedRevision = next.revision
      next.reviewDigest = draftReviewDigest(next)
      next.reviewedAt = new Date().toISOString()
      next.updatedAt = next.reviewedAt
      state.drafts[draftIndex] = next
      await this.writeState(state)
      return { draft: copyDraft(next), totals, digest: next.reviewDigest }
    })
  }

  async createSample(id: string, revision: number, reviewDigest: string, idempotencyKey: string): Promise<StoreResult<DocumentSample>> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const requestDigest = digest({ draftId: id, revision, reviewDigest })
      const priorKey = state.sampleIdempotency[idempotencyKey]
      if (priorKey) {
        if (priorKey.requestDigest !== requestDigest) fail('idempotency_conflict', 'Idempotency key was already used for a different sample request.', 409)
        const priorSample = state.samples.find((sample) => sample.id === priorKey.sampleId)
        if (!priorSample) fail('sample_missing', 'Sample record is unavailable.', 409)
        return { value: structuredClone(priorSample), created: false }
      }
      const draftIndex = state.drafts.findIndex((item) => item.id === id)
      if (draftIndex < 0) fail('draft_not_found', 'Draft does not exist.', 404)
      const draft = state.drafts[draftIndex]
      if (draft.sourceOrder) {
        const source = getOrderRecord(state, draft.sourceOrder.id)
        if (!source || source.currentRevision !== draft.sourceOrder.revision) fail('source_order_changed', 'The source order changed after review. Create a new draft from the current order before creating a sample.', 409)
      }
      if (draft.revision !== revision || draft.reviewedRevision !== revision || draft.status !== 'reviewed' ||
          draft.reviewDigest !== reviewDigest || draftReviewDigest(draft) !== reviewDigest) {
        fail('stale_review', 'Draft changed after review. Review the current version before creating a sample.', 409)
      }
      const missing = validateDraftForReview(draft)
      if (missing.length) fail('draft_incomplete', `Missing required fields: ${missing.join(', ')}.`, 409)
      const existingSameRevision = state.samples.find((sample) => sample.draftId === id && sample.draftRevision === revision)
      if (existingSameRevision) {
        state.sampleIdempotency[idempotencyKey] = { requestDigest, sampleId: existingSameRevision.id }
        await this.writeState(state)
        return { value: structuredClone(existingSameRevision), created: false }
      }
      if (state.samples.length >= MAX_SAMPLES) fail('sample_limit', 'The local sample limit has been reached.', 409)
      const totals = computeDocumentTotals(draft)
      if (totals.totalMinor === null) fail('invalid_totals', 'Document totals are incomplete or invalid.', 409)
      const sequence = state.sampleSequence + 1
      if (!Number.isSafeInteger(sequence)) fail('sample_sequence_exhausted', 'Sample number sequence is unavailable.', 500)
      const sample: DocumentSample = {
        id: randomUUID(), draftId: id, draftRevision: revision,
        sampleNumber: `SAMPLE-${new Date().getUTCFullYear()}-${String(sequence).padStart(6, '0')}`,
        status: 'SAMPLE / NOT FOR PAYMENT', type: draft.type,
        snapshot: copyDraft(draft), totals, digest: reviewDigest, createdAt: new Date().toISOString(),
      }
      state.sampleSequence = sequence
      state.samples.push(sample)
      state.sampleIdempotency[idempotencyKey] = { requestDigest, sampleId: sample.id }
      const updatedDraft = copyDraft(draft)
      updatedDraft.status = 'sample_created'
      updatedDraft.sampleId = sample.id
      updatedDraft.updatedAt = sample.createdAt
      state.drafts[draftIndex] = updatedDraft
      await this.writeState(state)
      return { value: structuredClone(sample), created: true }
    })
  }

  async listSamples(): Promise<DocumentSample[]> {
    const state = await this.requireState()
    return state.samples.map((sample) => structuredClone(sample)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getSample(id: string): Promise<DocumentSample> {
    const state = await this.requireState()
    const sample = state.samples.find((item) => item.id === id)
    if (!sample) fail('sample_not_found', 'Sample document does not exist.', 404)
    return structuredClone(sample)
  }

  async clearData(): Promise<{ orders: number; drafts: number; suggestions: number; samples: number; sampleSequencePreserved: number }> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const deleted = { orders: state.orders.length, drafts: state.drafts.length, suggestions: state.suggestions.length, samples: state.samples.length }
      const next: DocumentStoreState = { ...emptyState(), sampleSequence: state.sampleSequence }
      await this.writeState(next)
      return { ...deleted, sampleSequencePreserved: next.sampleSequence }
    })
  }

  async readHostedControl(): Promise<HostedControlState> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const control = state.hostedControl ?? emptyHostedControlState()
      if (!state.hostedControl) {
        state.hostedControl = control
        await this.writeState(state)
      }
      return structuredClone(control)
    })
  }

  async updateHostedControl<T>(update: (control: HostedControlState) => Promise<T> | T): Promise<T> {
    return withWriter(this.root, async () => {
      const state = await this.requireState()
      const control = state.hostedControl ?? emptyHostedControlState()
      const result = await update(control)
      state.hostedControl = control
      await this.writeState(state)
      return result
    })
  }

  private async requireState(): Promise<DocumentStoreState> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const state = await this.readState()
      if (!state) {
        const initial = emptyState()
        await this.writeState(initial)
        return initial
      }
      return state
    } catch (error) {
      if (error instanceof DocumentStoreError) throw error
      fail('store_io', 'Document data could not be read.', 500)
    }
  }

  private async readState(): Promise<DocumentStoreState | null> {
    let contents: string
    try {
      const info = await lstat(this.snapshotPath)
      if (!info.isFile() || info.isSymbolicLink()) fail('unsafe_storage_file', 'Document snapshot is not a regular file.', 500)
      if (info.size > SNAPSHOT_LIMIT) fail('store_too_large', 'Document data exceeds the local safety limit.', 500)
      contents = await readFile(this.snapshotPath, 'utf8')
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return null
      if (error instanceof DocumentStoreError) throw error
      fail('store_io', 'Document data could not be read.', 500)
    }
    let parsed: unknown
    try { parsed = JSON.parse(contents) } catch { fail('corrupt_store', 'Document data is invalid and was left unchanged.', 500) }
    if (!isState(parsed)) fail('corrupt_store', 'Document data failed schema validation and was left unchanged.', 500)
    return parsed
  }

  private async writeState(state: DocumentStoreState): Promise<void> {
    const temporaryPath = resolve(this.root, `snapshot.${randomUUID()}.tmp`)
    let file
    try {
      const contents = JSON.stringify(state)
      if (contents.length > SNAPSHOT_LIMIT) fail('store_too_large', 'Document data exceeds the local safety limit.', 409)
      file = await open(temporaryPath, 'wx', 0o600)
      await file.writeFile(contents, 'utf8')
      await file.sync()
      await file.close()
      file = undefined
      await rename(temporaryPath, this.snapshotPath)
      const directory = await open(this.root, 'r')
      await directory.sync()
      await directory.close()
    } catch (error) {
      if (file) await file.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      if (error instanceof DocumentStoreError) throw error
      fail('store_io', 'Document data could not be written atomically.', 500)
    }
  }
}

export async function createDocumentStore(root?: string): Promise<DocumentStore> {
  const store = new DocumentStore(root)
  await store.initialize()
  return store
}

export async function createHostedControlStore(): Promise<DocumentStore> {
  return createDocumentStore(resolve(process.cwd(), '.ezagent', 'documents', 'hosted-control'))
}

export async function createHostedOwnerStore(ownerId: string): Promise<DocumentStore> {
  if (!isUuid(ownerId)) fail('invalid_owner', 'Document owner is invalid.', 500)
  return createDocumentStore(resolve(process.cwd(), '.ezagent', 'documents', 'owners', ownerId))
}
