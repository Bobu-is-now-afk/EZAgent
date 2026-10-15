import { createHash, randomUUID } from 'node:crypto'
import type { DocumentDraft, DocumentTotals, OrderSnapshot } from './contracts'
import { computeDocumentTotals } from './money'
import { draftReviewDigest } from './store'

export const PHASE4_APPROVALS_FLAG = 'EZAGENT_PHASE4_APPROVALS_ENABLED'
export const APPROVAL_PREPARE_ROLE = 'documents:prepare'
export const APPROVAL_DECIDE_ROLE = 'documents:approve'

const ZERO_HASH = '0'.repeat(64)
const HEX_DIGEST = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export type ApprovalActor = {
  actorId: string
  organizationId: string
  roles: readonly string[]
}

/** Implementations must resolve server-verified identity and organization claims; never trust request body, query, or role selectors. */
export interface TrustedActorProvider {
  resolveActor(request: Request): Promise<unknown>
}

/** No identity provider is wired in Phase 4 groundwork. Missing auth fails closed. */
export const unavailableTrustedActorProvider: TrustedActorProvider = {
  async resolveActor() { return null },
}

export type ServerApprovalMaterial = {
  organizationId: string
  policyVersion: string
  draft: DocumentDraft
  sourceOrder: OrderSnapshot | null
  exportDigest: string
}

/** Must load the current draft, source order, and export digest inside the requested server-verified organization. */
export interface ApprovalMaterialProvider {
  loadCurrentMaterial(organizationId: string, draftId: string): Promise<unknown>
}

/** Proposals must be loaded by server-derived organization and server-issued proposal ID. */
export interface ApprovalProposalRepository {
  create(proposal: ApprovalProposal): Promise<void>
  getForOrganization(organizationId: string, proposalId: string): Promise<unknown | null>
}

export const unavailableApprovalMaterialProvider: ApprovalMaterialProvider = {
  async loadCurrentMaterial() { return null },
}

export const unavailableApprovalProposalRepository: ApprovalProposalRepository = {
  async create() { throw new Error('Approval proposal storage is unavailable.') },
  async getForOrganization() { return null },
}

export type ApprovalMode = 'disabled' | 'enabled' | 'invalid'

export function readApprovalMode(env: NodeJS.ProcessEnv = process.env): ApprovalMode {
  const flag = env[PHASE4_APPROVALS_FLAG]
  if (flag === undefined || flag === '0') return 'disabled'
  if (flag === '1') return 'enabled'
  return 'invalid'
}

function stableObjectHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isApprovalActor(value: unknown): value is ApprovalActor {
  return isRecord(value) && Object.keys(value).sort().join(',') === 'actorId,organizationId,roles' &&
    typeof value.actorId === 'string' && STABLE_ID.test(value.actorId) &&
    typeof value.organizationId === 'string' && STABLE_ID.test(value.organizationId) &&
    Array.isArray(value.roles) && value.roles.length <= 16 && value.roles.every((role) => typeof role === 'string' && STABLE_ID.test(role)) &&
    new Set(value.roles).size === value.roles.length
}

export async function resolveTrustedActor(provider: TrustedActorProvider, request: Request): Promise<ApprovalActor | null> {
  try {
    const actor = await provider.resolveActor(request)
    return isApprovalActor(actor) ? { actorId: actor.actorId, organizationId: actor.organizationId, roles: [...actor.roles] } : null
  } catch {
    return null
  }
}

export type ApprovalBinding = {
  schemaVersion: 1
  organizationId: string
  policyVersion: string
  sourceOrder: { id: string; revision: number; digest: string } | null
  draftId: string
  draftRevision: number
  reviewDigest: string
  totals: DocumentTotals
  totalsDigest: string
  exportDigest: string
  bindingDigest: string
}

export class ApprovalContractError extends Error {
  readonly code: 'invalid_actor' | 'role_required' | 'draft_not_reviewed' | 'draft_review_tampered' | 'source_order_mismatch' | 'invalid_export_digest' | 'invalid_policy_version' | 'organization_mismatch' | 'self_approval' | 'stale_binding' | 'approval_disabled' | 'audit_log_unavailable' | 'idempotency_conflict' | 'approval_material_unavailable' | 'proposal_store_unavailable'
  constructor(code: ApprovalContractError['code'], message: string) {
    super(message)
    this.name = 'ApprovalContractError'
    this.code = code
  }
}

export function createApprovalBinding(input: {
  organizationId: string
  policyVersion: string
  draft: DocumentDraft
  sourceOrder: OrderSnapshot | null
  exportDigest: string
}): ApprovalBinding {
  const { organizationId, policyVersion, draft, sourceOrder, exportDigest } = input
  if (!STABLE_ID.test(organizationId)) throw new ApprovalContractError('invalid_actor', 'Trusted organization identity is invalid.')
  if (!STABLE_ID.test(policyVersion)) throw new ApprovalContractError('invalid_policy_version', 'Approval policy version is invalid.')
  if (!UUID.test(draft.id) || !Number.isSafeInteger(draft.revision) || draft.revision < 1 || draft.status !== 'reviewed' ||
      draft.reviewedRevision !== draft.revision || !draft.reviewDigest || !HEX_DIGEST.test(draft.reviewDigest)) {
    throw new ApprovalContractError('draft_not_reviewed', 'Only the exact reviewed draft revision can be proposed for approval.')
  }
  if (draftReviewDigest(draft) !== draft.reviewDigest) {
    throw new ApprovalContractError('draft_review_tampered', 'Draft content no longer matches its reviewed digest.')
  }
  let source: ApprovalBinding['sourceOrder'] = null
  if (draft.sourceOrder) {
    if (!sourceOrder || sourceOrder.id !== draft.sourceOrder.id || sourceOrder.revision !== draft.sourceOrder.revision ||
        sourceOrder.status !== 'active' || !UUID.test(sourceOrder.id)) {
      throw new ApprovalContractError('source_order_mismatch', 'The source order revision does not match the reviewed draft.')
    }
    source = { id: sourceOrder.id, revision: sourceOrder.revision, digest: stableObjectHash(sourceOrder) }
  } else if (sourceOrder !== null) {
    throw new ApprovalContractError('source_order_mismatch', 'An unlinked draft cannot bind to a client-selected source order.')
  }
  const totals = computeDocumentTotals(draft)
  if (totals.totalMinor === null || !HEX_DIGEST.test(exportDigest)) {
    throw new ApprovalContractError('invalid_export_digest', 'A server-generated export digest and complete totals are required.')
  }
  const body = {
    schemaVersion: 1 as const,
    organizationId,
    policyVersion,
    sourceOrder: source,
    draftId: draft.id,
    draftRevision: draft.revision,
    reviewDigest: draft.reviewDigest,
    totals,
    totalsDigest: stableObjectHash(totals),
    exportDigest,
  }
  return { ...body, bindingDigest: stableObjectHash(body) }
}

export type ApprovalProposal = {
  schemaVersion: 1
  proposalId: string
  preparedByActorId: string
  createdAt: string
  binding: ApprovalBinding
}

export async function createApprovalProposal(input: {
  env?: NodeJS.ProcessEnv
  request: Request
  draftId: string
  actorProvider?: TrustedActorProvider
  materialProvider?: ApprovalMaterialProvider
  proposalRepository?: ApprovalProposalRepository
  now?: Date
}): Promise<ApprovalProposal> {
  if (readApprovalMode(input.env) !== 'enabled') throw new ApprovalContractError('approval_disabled', 'Synthetic approval proposals are disabled.')
  if (!UUID.test(input.draftId)) throw new ApprovalContractError('approval_material_unavailable', 'Draft is unavailable in the trusted organization scope.')
  const actor = await resolveTrustedActor(input.actorProvider ?? unavailableTrustedActorProvider, input.request)
  if (!actor) throw new ApprovalContractError('invalid_actor', 'A trusted actor is required.')
  if (!actor.roles.includes(APPROVAL_PREPARE_ROLE)) throw new ApprovalContractError('role_required', 'Trusted actor cannot prepare an approval proposal.')
  const material = await loadApprovalMaterial(input.materialProvider ?? unavailableApprovalMaterialProvider, actor.organizationId, input.draftId)
  if (!material || material.organizationId !== actor.organizationId || material.draft.id !== input.draftId) {
    throw new ApprovalContractError('approval_material_unavailable', 'Draft is unavailable in the trusted organization scope.')
  }
  const binding = createApprovalBinding({ organizationId: actor.organizationId, policyVersion: material.policyVersion,
    draft: material.draft, sourceOrder: material.sourceOrder, exportDigest: material.exportDigest })
  const createdAt = (input.now ?? new Date()).toISOString()
  if (!Number.isFinite(Date.parse(createdAt))) throw new ApprovalContractError('invalid_actor', 'Proposal timestamp is invalid.')
  const proposal = { schemaVersion: 1 as const, proposalId: randomUUID(), preparedByActorId: actor.actorId, createdAt, binding }
  try {
    if (!input.proposalRepository) throw new Error('Approval proposal storage is unavailable.')
    await input.proposalRepository.create(proposal)
  } catch {
    throw new ApprovalContractError('proposal_store_unavailable', 'Approval proposal could not be persisted.')
  }
  return proposal
}

export type ApprovalAuditEvent = {
  schemaVersion: 1
  scope: 'synthetic_proposal_only'
  organizationId: string
  proposalId: string
  decision: 'approve' | 'reject'
  actorId: string
  preparedByActorId: string
  policyVersion: string
  bindingDigest: string
  idempotencyDigest: string
  decidedAt: string
}

export type ApprovalAuditEntry = ApprovalAuditEvent & {
  sequence: number
  previousHash: string
  entryHash: string
}

/** A future durable implementation must atomically append, preserve history, and enforce idempotency across restarts. */
export interface AppendOnlyApprovalAuditLog {
  append(event: ApprovalAuditEvent): Promise<ApprovalAuditEntry>
}

export type ApprovalDecisionCommit = {
  organizationId: string
  draftId: string
  proposalId: string
  expectedBindingDigest: string
  event: ApprovalAuditEvent
}

/**
 * Future durable implementations must atomically reload current org-scoped material, compare its binding digest,
 * and append the event with durable idempotency. A read followed by an independent append is not sufficient.
 */
export interface AtomicApprovalDecisionCommitter {
  appendIfCurrent(input: ApprovalDecisionCommit): Promise<{ status: 'stale' } | { status: 'appended'; entry: ApprovalAuditEntry }>
}

export const unavailableApprovalDecisionCommitter: AtomicApprovalDecisionCommitter = {
  async appendIfCurrent() { throw new Error('Atomic approval decision storage is unavailable.') },
}

export type ApprovalDecisionResult =
  | { status: 'disabled' | 'unavailable' | 'refused'; code?: ApprovalContractError['code'] }
  | { status: 'recorded'; entry: ApprovalAuditEntry }

export async function decideSyntheticProposal(input: {
  env?: NodeJS.ProcessEnv
  request: Request
  actorProvider?: TrustedActorProvider
  materialProvider?: ApprovalMaterialProvider
  proposalRepository?: ApprovalProposalRepository
  decisionCommitter?: AtomicApprovalDecisionCommitter
  proposalId: string
  decision: 'approve' | 'reject'
  idempotencyKey: string
  now?: Date
}): Promise<ApprovalDecisionResult> {
  const mode = readApprovalMode(input.env)
  if (mode === 'disabled') return { status: 'disabled' }
  if (mode === 'invalid' || !input.decisionCommitter || !input.proposalRepository) return { status: 'unavailable', code: 'approval_disabled' }
  const actor = await resolveTrustedActor(input.actorProvider ?? unavailableTrustedActorProvider, input.request)
  if (!actor) return { status: 'refused', code: 'invalid_actor' }
  if (!actor.roles.includes(APPROVAL_DECIDE_ROLE)) return { status: 'refused', code: 'role_required' }
  if (!UUID.test(input.proposalId) || (input.decision !== 'approve' && input.decision !== 'reject')) return { status: 'refused', code: 'stale_binding' }
  let proposalValue: unknown
  try { proposalValue = await input.proposalRepository.getForOrganization(actor.organizationId, input.proposalId) }
  catch { return { status: 'unavailable', code: 'proposal_store_unavailable' } }
  if (!isApprovalProposal(proposalValue)) return { status: 'refused', code: 'stale_binding' }
  const proposal = proposalValue
  if (actor.organizationId !== proposal.binding.organizationId) return { status: 'refused', code: 'organization_mismatch' }
  if (actor.actorId === proposal.preparedByActorId) return { status: 'refused', code: 'self_approval' }
  const material = await loadApprovalMaterial(input.materialProvider ?? unavailableApprovalMaterialProvider,
    actor.organizationId, proposal.binding.draftId)
  if (!material || material.organizationId !== actor.organizationId || material.draft.id !== proposal.binding.draftId) {
    return { status: 'refused', code: 'stale_binding' }
  }
  let currentBinding: ApprovalBinding
  try {
    currentBinding = createApprovalBinding({ organizationId: actor.organizationId, policyVersion: material.policyVersion,
      draft: material.draft, sourceOrder: material.sourceOrder, exportDigest: material.exportDigest })
  } catch {
    return { status: 'refused', code: 'stale_binding' }
  }
  if (currentBinding.bindingDigest !== proposal.binding.bindingDigest) return { status: 'refused', code: 'stale_binding' }
  if (
      !STABLE_ID.test(input.idempotencyKey) || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
    return { status: 'unavailable', code: 'approval_disabled' }
  }
  const decidedAt = (input.now ?? new Date()).toISOString()
  const event: ApprovalAuditEvent = {
    schemaVersion: 1, scope: 'synthetic_proposal_only', organizationId: actor.organizationId,
    proposalId: proposal.proposalId, decision: input.decision, actorId: actor.actorId,
    preparedByActorId: proposal.preparedByActorId, policyVersion: proposal.binding.policyVersion,
    bindingDigest: proposal.binding.bindingDigest,
    idempotencyDigest: createHash('sha256').update(input.idempotencyKey, 'utf8').digest('hex'), decidedAt,
  }
  try {
    const committed = await input.decisionCommitter.appendIfCurrent({
      organizationId: actor.organizationId, draftId: proposal.binding.draftId,
      proposalId: proposal.proposalId, expectedBindingDigest: proposal.binding.bindingDigest, event,
    })
    if (committed.status === 'stale') return { status: 'refused', code: 'stale_binding' }
    const entry = committed.entry
    if (!isValidApprovalAuditEntry(entry) || !approvalAuditEventMatches(entry, event)) return { status: 'unavailable', code: 'audit_log_unavailable' }
    return { status: 'recorded', entry }
  } catch (error) {
    return { status: 'unavailable', code: error instanceof ApprovalContractError ? error.code : 'audit_log_unavailable' }
  }
}

export function approvalAuditEntryHash(entry: Omit<ApprovalAuditEntry, 'entryHash'>): string {
  return stableObjectHash(entry)
}

export function isValidApprovalAuditEntry(value: unknown): value is ApprovalAuditEntry {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'actorId,bindingDigest,decidedAt,decision,entryHash,idempotencyDigest,organizationId,policyVersion,preparedByActorId,previousHash,proposalId,schemaVersion,scope,sequence' ||
      value.schemaVersion !== 1 || value.scope !== 'synthetic_proposal_only' ||
      !STABLE_ID.test(String(value.organizationId)) || !UUID.test(String(value.proposalId)) ||
      (value.decision !== 'approve' && value.decision !== 'reject') || !STABLE_ID.test(String(value.actorId)) ||
      !STABLE_ID.test(String(value.preparedByActorId)) || !STABLE_ID.test(String(value.policyVersion)) ||
      !HEX_DIGEST.test(String(value.bindingDigest)) || !HEX_DIGEST.test(String(value.idempotencyDigest)) ||
      typeof value.decidedAt !== 'string' || !Number.isFinite(Date.parse(value.decidedAt)) ||
      !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1 ||
      (value.previousHash !== ZERO_HASH && !HEX_DIGEST.test(String(value.previousHash))) || !HEX_DIGEST.test(String(value.entryHash))) return false
  const { entryHash, ...body } = value as unknown as ApprovalAuditEntry
  return approvalAuditEntryHash(body) === entryHash
}

export function verifyApprovalAuditChain(entries: readonly ApprovalAuditEntry[]): boolean {
  let previousHash = ZERO_HASH
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!isValidApprovalAuditEntry(entry) || entry.sequence !== index + 1 || entry.previousHash !== previousHash) return false
    previousHash = entry.entryHash
  }
  return true
}

export function isValidApprovalBinding(value: unknown): value is ApprovalBinding {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'bindingDigest,draftId,draftRevision,exportDigest,organizationId,policyVersion,reviewDigest,schemaVersion,sourceOrder,totals,totalsDigest' ||
      value.schemaVersion !== 1 || !STABLE_ID.test(String(value.organizationId)) ||
      !STABLE_ID.test(String(value.policyVersion)) || !UUID.test(String(value.draftId)) ||
      !Number.isSafeInteger(value.draftRevision) || (value.draftRevision as number) < 1 ||
      !HEX_DIGEST.test(String(value.reviewDigest)) || !isRecord(value.totals) ||
      Object.keys(value.totals).sort().join(',') !== 'currency,subtotalMinor,taxMinor,totalMinor' ||
      (value.totals.currency !== 'HKD' && value.totals.currency !== 'TWD') ||
      !Number.isSafeInteger(value.totals.subtotalMinor) || (value.totals.subtotalMinor as number) < 0 ||
      (value.totals.taxMinor !== null && (!Number.isSafeInteger(value.totals.taxMinor) || (value.totals.taxMinor as number) < 0)) ||
      !Number.isSafeInteger(value.totals.totalMinor) || (value.totals.totalMinor as number) < 0 ||
      !HEX_DIGEST.test(String(value.totalsDigest)) || !HEX_DIGEST.test(String(value.exportDigest)) ||
      !HEX_DIGEST.test(String(value.bindingDigest))) return false
  const body = { ...value }
  delete body.bindingDigest
  if (stableObjectHash(body) !== value.bindingDigest) return false
  if (value.sourceOrder === null) return true
  if (!isRecord(value.sourceOrder) || Object.keys(value.sourceOrder).sort().join(',') !== 'digest,id,revision' ||
      !UUID.test(String(value.sourceOrder.id)) ||
      !Number.isSafeInteger(value.sourceOrder.revision) || (value.sourceOrder.revision as number) < 1 ||
      !HEX_DIGEST.test(String(value.sourceOrder.digest))) return false
  return true
}

async function loadApprovalMaterial(provider: ApprovalMaterialProvider, organizationId: string, draftId: string): Promise<ServerApprovalMaterial | null> {
  try {
    const value = await provider.loadCurrentMaterial(organizationId, draftId)
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'draft,exportDigest,organizationId,policyVersion,sourceOrder' ||
        typeof value.organizationId !== 'string' || !STABLE_ID.test(value.organizationId) ||
        typeof value.policyVersion !== 'string' || !STABLE_ID.test(value.policyVersion) ||
        !isRecord(value.draft) || !isRecord(value.draft.sourceOrder) && value.draft.sourceOrder !== null ||
        typeof value.exportDigest !== 'string' || !HEX_DIGEST.test(value.exportDigest)) return null
    return value as unknown as ServerApprovalMaterial
  } catch {
    return null
  }
}

function approvalAuditEventMatches(entry: ApprovalAuditEntry, event: ApprovalAuditEvent): boolean {
  // A durable idempotent retry returns the original ledger row and timestamp.
  // Compare every decision-defining field while allowing that stored timestamp
  // to differ from the retry's newly generated timestamp.
  return (Object.keys(event) as Array<keyof ApprovalAuditEvent>)
    .filter((key) => key !== 'decidedAt')
    .every((key) => entry[key] === event[key])
}

function isApprovalProposal(value: unknown): value is ApprovalProposal {
  return isRecord(value) && Object.keys(value).sort().join(',') === 'binding,createdAt,preparedByActorId,proposalId,schemaVersion' &&
    value.schemaVersion === 1 && UUID.test(String(value.proposalId)) && STABLE_ID.test(String(value.preparedByActorId)) &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) && isValidApprovalBinding(value.binding)
}
