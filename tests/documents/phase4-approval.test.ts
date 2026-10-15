import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import type { DocumentDraft, OrderSnapshot } from '../../lib/documents/contracts'
import { draftReviewDigest } from '../../lib/documents/store'
import {
  APPROVAL_DECIDE_ROLE, APPROVAL_PREPARE_ROLE, ApprovalContractError, approvalAuditEntryHash,
  createApprovalBinding, createApprovalProposal, decideSyntheticProposal, readApprovalMode,
  unavailableApprovalMaterialProvider, unavailableApprovalProposalRepository, unavailableTrustedActorProvider,
  verifyApprovalAuditChain, type ApprovalActor, type ApprovalAuditEntry, type ApprovalAuditEvent,
  type ApprovalMaterialProvider, type ApprovalProposalRepository, type AppendOnlyApprovalAuditLog,
  type AtomicApprovalDecisionCommitter, type ApprovalDecisionCommit,
} from '../../lib/documents/phase4-approval'

const orgA = 'org-synthetic-a'
const preparer: ApprovalActor = { actorId: 'actor-synthetic-preparer', organizationId: orgA, roles: [APPROVAL_PREPARE_ROLE] }
const approver: ApprovalActor = { actorId: 'actor-synthetic-approver', organizationId: orgA, roles: [APPROVAL_DECIDE_ROLE] }
const policyVersion = 'synthetic-policy-v1'
const exportDigest = createHash('sha256').update('synthetic export bytes').digest('hex')
const enabledEnv = { NODE_ENV: 'test', EZAGENT_PHASE4_APPROVALS_ENABLED: '1' } as NodeJS.ProcessEnv
const request = () => new Request('https://approval.example.test/internal/proposal')

function fixture() {
  const orderId = randomUUID()
  const draft: DocumentDraft = {
    id: randomUUID(), revision: 3, type: 'quotation', status: 'reviewed',
    sourceOrder: { id: orderId, revision: 2 }, linkedDocumentId: null, sellerProfileRef: null,
    buyer: { name: 'Synthetic buyer A', address: null, contact: null }, currency: 'HKD',
    items: [{ id: randomUUID(), name: 'Synthetic service', description: 'Synthetic description', quantity: 2, unitPriceMinor: 12_500 }],
    termsText: 'Synthetic terms only', issueDate: '2026-10-15', dueDate: null, validUntil: '2026-11-15',
    paymentDate: null, paymentAmountMinor: null, paymentMethod: null, taxMode: 'none', taxRateBasisPoints: 0,
    provenance: {}, reviewedRevision: 3, reviewDigest: null, reviewedAt: '2026-10-15T00:00:00.000Z',
    sampleId: null, createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
  }
  draft.reviewDigest = draftReviewDigest(draft)
  const sourceOrder: OrderSnapshot = {
    id: orderId, revision: 2, status: 'active', buyer: structuredClone(draft.buyer), currency: 'HKD',
    items: structuredClone(draft.items), agreedDate: null, termsText: 'Synthetic source terms',
    source: { kind: 'manual', referenceId: null, referenceVersion: null }, provenance: {},
    createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
  }
  const material = { organizationId: orgA, policyVersion, draft, sourceOrder, exportDigest }
  return { material, draft, sourceOrder }
}

function actorProvider(actor: ApprovalActor | null) { return { async resolveActor() { return actor } } }

class SyntheticMemoryProposalRepository implements ApprovalProposalRepository {
  private readonly proposals = new Map<string, unknown>()
  async create(proposal: Parameters<ApprovalProposalRepository['create']>[0]) {
    this.proposals.set(proposal.proposalId, structuredClone(proposal))
  }
  async getForOrganization(organizationId: string, proposalId: string) {
    const value = this.proposals.get(proposalId)
    if (typeof value !== 'object' || value === null || !('binding' in value) || typeof value.binding !== 'object' || value.binding === null ||
        !('organizationId' in value.binding) || value.binding.organizationId !== organizationId) return null
    return structuredClone(value)
  }
  async getRegardlessOfOrganization(proposalId: string) { return structuredClone(this.proposals.get(proposalId) ?? null) }
}

class SyntheticMemoryAuditLog implements AppendOnlyApprovalAuditLog {
  private entries: ApprovalAuditEntry[]
  constructor(entries: ApprovalAuditEntry[] = []) {
    this.entries = structuredClone(entries)
    if (!verifyApprovalAuditChain(this.entries)) throw new Error('Invalid test ledger snapshot.')
  }
  async append(event: ApprovalAuditEvent): Promise<ApprovalAuditEntry> {
    const existing = this.entries.find((entry) => entry.idempotencyDigest === event.idempotencyDigest)
    if (existing) {
      const semantic = (item: ApprovalAuditEvent) => JSON.stringify({
        organizationId: item.organizationId, proposalId: item.proposalId, decision: item.decision,
        actorId: item.actorId, preparedByActorId: item.preparedByActorId,
        policyVersion: item.policyVersion, bindingDigest: item.bindingDigest,
      })
      if (semantic(existing) !== semantic(event)) throw new ApprovalContractError('idempotency_conflict', 'Synthetic idempotency conflict.')
      return structuredClone(existing)
    }
    const body = { ...structuredClone(event), sequence: this.entries.length + 1, previousHash: this.entries.at(-1)?.entryHash ?? '0'.repeat(64) }
    const entry: ApprovalAuditEntry = { ...body, entryHash: approvalAuditEntryHash(body) }
    this.entries.push(entry)
    return structuredClone(entry)
  }
  snapshot() { return structuredClone(this.entries) }
}

class SyntheticMemoryDecisionCommitter implements AtomicApprovalDecisionCommitter {
  constructor(private readonly readCurrent: () => ReturnType<typeof fixture>['material'] | null, private readonly log: AppendOnlyApprovalAuditLog) {}
  async appendIfCurrent(input: ApprovalDecisionCommit) {
    const current = this.readCurrent()
    if (!current || current.organizationId !== input.organizationId || current.draft.id !== input.draftId) return { status: 'stale' as const }
    let binding
    try {
      binding = createApprovalBinding({ organizationId: current.organizationId, policyVersion: current.policyVersion,
        draft: current.draft, sourceOrder: current.sourceOrder, exportDigest: current.exportDigest })
    } catch { return { status: 'stale' as const } }
    if (binding.bindingDigest !== input.expectedBindingDigest) return { status: 'stale' as const }
    return { status: 'appended' as const, entry: await this.log.append(input.event) }
  }
}

function materialProvider(material: ReturnType<typeof fixture>['material'] | null = null): ApprovalMaterialProvider {
  return { async loadCurrentMaterial(organizationId, draftId) {
    return material?.organizationId === organizationId && material.draft.id === draftId ? structuredClone(material) : null
  } }
}

async function createProposal(material: ReturnType<typeof fixture>['material'], repository = new SyntheticMemoryProposalRepository()) {
  const proposal = await createApprovalProposal({ env: enabledEnv, request: request(), draftId: material.draft.id,
    actorProvider: actorProvider(preparer), materialProvider: materialProvider(material), proposalRepository: repository,
    now: new Date('2026-10-15T01:00:00.000Z') })
  return { proposal, repository }
}

function decisionInput(input: {
  actor?: ApprovalActor | null
  material: ReturnType<typeof fixture>['material'] | null
  proposalId: string
  repository: ApprovalProposalRepository
  log?: AppendOnlyApprovalAuditLog
  committer?: AtomicApprovalDecisionCommitter
  idempotencyKey?: string
  now?: Date
}) {
  return decideSyntheticProposal({ env: enabledEnv, request: request(), actorProvider: actorProvider(input.actor ?? approver),
    materialProvider: materialProvider(input.material), proposalRepository: input.repository,
    decisionCommitter: input.committer ?? new SyntheticMemoryDecisionCommitter(() => input.material, input.log ?? new SyntheticMemoryAuditLog()),
    proposalId: input.proposalId,
    decision: 'approve', idempotencyKey: input.idempotencyKey ?? 'synthetic-idempotency-key-0001', now: input.now })
}

test('approval feature defaults off and actor, material, and proposal stores fail closed', async () => {
  assert.equal(readApprovalMode({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), 'disabled')
  assert.equal(readApprovalMode({ NODE_ENV: 'test', EZAGENT_PHASE4_APPROVALS_ENABLED: 'invalid' } as NodeJS.ProcessEnv), 'invalid')
  assert.equal(await unavailableTrustedActorProvider.resolveActor(request()), null)
  assert.equal(await unavailableApprovalMaterialProvider.loadCurrentMaterial(orgA, randomUUID()), null)
  assert.equal(await unavailableApprovalProposalRepository.getForOrganization(orgA, randomUUID()), null)
  await assert.rejects(createApprovalProposal({ request: request(), draftId: randomUUID(), actorProvider: actorProvider(preparer) }),
    (error: unknown) => error instanceof ApprovalContractError && error.code === 'approval_disabled')
  const { material } = fixture()
  const disabled = await createApprovalProposal({ env: enabledEnv, request: request(), draftId: material.draft.id,
    actorProvider: actorProvider(preparer), materialProvider: materialProvider(material) })
    .catch((error: unknown) => error)
  assert.ok(disabled instanceof ApprovalContractError && disabled.code === 'proposal_store_unavailable')
  const result = await decideSyntheticProposal({ request: request(), proposalId: randomUUID(), decision: 'approve', idempotencyKey: 'synthetic-idempotency-key-0001' })
  assert.deepEqual(result, { status: 'disabled' })
})

test('proposals are prepared from organization-scoped server material and prevent self/cross-organization approval', async () => {
  const { material } = fixture()
  const { proposal, repository } = await createProposal(material)
  assert.equal(proposal.preparedByActorId, preparer.actorId)
  const log = new SyntheticMemoryAuditLog()
  const self = await decisionInput({ actor: { ...preparer, roles: [APPROVAL_PREPARE_ROLE, APPROVAL_DECIDE_ROLE] }, material, proposalId: proposal.proposalId, repository, log })
  assert.deepEqual(self, { status: 'refused', code: 'self_approval' })
  const crossOrgRepository: ApprovalProposalRepository = {
    async create() {},
    getForOrganization: (_organizationId, proposalId) => repository.getRegardlessOfOrganization(proposalId),
  }
  const crossOrg = await decisionInput({ actor: { ...approver, organizationId: 'org-synthetic-b' }, material,
    proposalId: proposal.proposalId, repository: crossOrgRepository, log })
  assert.deepEqual(crossOrg, { status: 'refused', code: 'organization_mismatch' })
  const noRole = await decisionInput({ actor: { ...approver, roles: [] }, material, proposalId: proposal.proposalId, repository, log })
  assert.deepEqual(noRole, { status: 'refused', code: 'role_required' })
  assert.equal(log.snapshot().length, 0)
})

test('approval binding covers exact draft review, source revision, totals, and export digest', async () => {
  const { material, draft, sourceOrder } = fixture()
  const binding = createApprovalBinding({ organizationId: orgA, policyVersion, draft, sourceOrder, exportDigest })
  assert.throws(() => createApprovalBinding({ organizationId: orgA, policyVersion,
    draft: { ...draft, termsText: 'Edited after review' }, sourceOrder, exportDigest }),
  (error: unknown) => error instanceof ApprovalContractError && error.code === 'draft_review_tampered')
  assert.throws(() => createApprovalBinding({ organizationId: orgA, policyVersion, draft,
    sourceOrder: { ...sourceOrder, revision: sourceOrder.revision + 1 }, exportDigest }),
  (error: unknown) => error instanceof ApprovalContractError && error.code === 'source_order_mismatch')
  const changedExport = createApprovalBinding({ organizationId: orgA, policyVersion, draft, sourceOrder,
    exportDigest: createHash('sha256').update('different synthetic export').digest('hex') })
  assert.notEqual(binding.bindingDigest, changedExport.bindingDigest)
  assert.equal(material.organizationId, binding.organizationId)
})

test('decision reloads current organization-scoped state and refuses edits, hash changes, and missing material', async () => {
  const { material } = fixture()
  const { proposal, repository } = await createProposal(material)
  const log = new SyntheticMemoryAuditLog()
  const editedMaterial = { ...material, draft: { ...material.draft, termsText: 'Changed after proposal' } }
  const changed = await decisionInput({ material: editedMaterial, proposalId: proposal.proposalId, repository, log })
  assert.deepEqual(changed, { status: 'refused', code: 'stale_binding' })
  const changedExport = { ...material, exportDigest: 'f'.repeat(64) }
  const changedHash = await decisionInput({ material: changedExport, proposalId: proposal.proposalId, repository, log })
  assert.deepEqual(changedHash, { status: 'refused', code: 'stale_binding' })
  const missing = await decisionInput({ material: null, proposalId: proposal.proposalId, repository, log })
  assert.deepEqual(missing, { status: 'refused', code: 'stale_binding' })
  assert.equal(log.snapshot().length, 0)
})

test('atomic compare-and-append rejects a material edit racing the decision', async () => {
  const { material } = fixture()
  const { proposal, repository } = await createProposal(material)
  const log = new SyntheticMemoryAuditLog()
  const editedDuringCommit = { ...material, exportDigest: createHash('sha256').update('raced synthetic export').digest('hex') }
  const result = await decisionInput({ material, proposalId: proposal.proposalId, repository, log,
    committer: new SyntheticMemoryDecisionCommitter(() => editedDuringCommit, log) })
  assert.deepEqual(result, { status: 'refused', code: 'stale_binding' })
  assert.equal(log.snapshot().length, 0)
})

test('synthetic audit records are hash chained, immutable by snapshot, and idempotent across restart', async () => {
  const { material } = fixture()
  const { proposal, repository } = await createProposal(material)
  const beforeRestart = new SyntheticMemoryAuditLog()
  const eventTime = new Date('2026-10-15T01:05:00.000Z')
  const first = await decisionInput({ material, proposalId: proposal.proposalId, repository, log: beforeRestart, now: eventTime })
  assert.equal(first.status, 'recorded')
  if (first.status !== 'recorded') return
  assert.equal(first.entry.scope, 'synthetic_proposal_only')
  assert.equal(first.entry.actorId, approver.actorId)
  assert.equal(first.entry.preparedByActorId, preparer.actorId)
  const afterRestart = new SyntheticMemoryAuditLog(beforeRestart.snapshot())
  const retry = await decisionInput({ material, proposalId: proposal.proposalId, repository, log: afterRestart,
    now: new Date('2026-10-15T01:06:00.000Z') })
  assert.equal(retry.status, 'recorded')
  if (retry.status !== 'recorded') return
  assert.equal(retry.entry.entryHash, first.entry.entryHash)
  assert.equal(afterRestart.snapshot().length, 1)
  const copied = afterRestart.snapshot()
  copied[0].decision = 'reject'
  assert.equal(afterRestart.snapshot()[0].decision, 'approve')
  assert.equal(verifyApprovalAuditChain(afterRestart.snapshot()), true)
  const tampered = afterRestart.snapshot()
  tampered[0].bindingDigest = 'f'.repeat(64)
  assert.equal(verifyApprovalAuditChain(tampered), false)
})

test('audit write failure and mismatched audit response never report a recorded decision', async () => {
  const { material } = fixture()
  const { proposal, repository } = await createProposal(material)
  const failed = await decisionInput({ material, proposalId: proposal.proposalId, repository,
    log: { async append() { throw new Error('synthetic audit write failure') } } })
  assert.deepEqual(failed, { status: 'unavailable', code: 'audit_log_unavailable' })
  const wrongActorLog: AppendOnlyApprovalAuditLog = { async append(event) {
    const body = { ...event, actorId: 'actor-synthetic-substituted', sequence: 1, previousHash: '0'.repeat(64) }
    return { ...body, entryHash: approvalAuditEntryHash(body) }
  } }
  const wrongActor = await decisionInput({ material, proposalId: proposal.proposalId, repository, log: wrongActorLog })
  assert.deepEqual(wrongActor, { status: 'unavailable', code: 'audit_log_unavailable' })
})
