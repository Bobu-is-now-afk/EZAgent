import { calculateBatch, validateAssumptions } from './engine'
import type { ApprovalSnapshot, ChangeEvent, CalculationResult, PendingCalculation, ReviewBatch, ReviewState, Role } from './types'

export type ReviewAction =
  | { type: 'SET_ROLE'; role: Role }
  | { type: 'SET_DIRTY'; dirty: boolean }
  | { type: 'COMMIT_BATCH'; batch: ReviewBatch; event: ChangeEvent; affectsFacts: boolean }
  | { type: 'START_CALCULATION'; pending: PendingCalculation }
  | { type: 'CALCULATION_SUCCEEDED'; result: CalculationResult }
  | { type: 'CALCULATION_FAILED'; pending: PendingCalculation; message: string }
  | { type: 'RETRY_CALCULATION' }
  | { type: 'MARK_RESULTS_REVIEWED' }
  | { type: 'MARK_DRAFTS_REVIEWED' }
  | { type: 'APPROVE'; snapshot: ApprovalSnapshot }
  | { type: 'REVOKE_APPROVAL'; at: string }
  | { type: 'LOAD_WORKING_COPY'; state: ReviewState }
  | { type: 'SET_NOTICE'; notice?: string }

function invalidateCurrentApproval(state: ReviewState, revision: number, at: string): ApprovalSnapshot[] {
  return state.approvalHistory.map((approval) => approval.approvalId === state.currentApprovalId
    ? { ...approval, invalidatedAt: at, invalidatedByRevision: revision }
    : approval)
}

export function createInitialState(batch: ReviewBatch): ReviewState {
  return {
    batch: structuredClone(batch),
    status: 'review',
    role: 'reviewer',
    identityMode: 'demo',
    calculation: calculateBatch(batch, 'initial-synthetic-result'),
    dirtyEditor: false,
    resultsReviewed: false,
    draftsReviewed: false,
    changes: [],
    approvalHistory: [],
  }
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'SET_ROLE': return { ...state, role: action.role, notice: undefined }
    case 'SET_DIRTY': return { ...state, dirtyEditor: action.dirty }
    case 'SET_NOTICE': return { ...state, notice: action.notice }
    case 'COMMIT_BATCH': {
      const changedAt = action.event.at
      const drafts = action.affectsFacts
        ? action.batch.drafts.map((draft) => draft.manuallyEdited ? { ...draft, stale: true } : { ...draft, basisRevision: action.batch.revision, stale: false })
        : action.batch.drafts
      return {
        ...state,
        batch: { ...action.batch, drafts },
        status: action.affectsFacts ? 'calculating' : 'review',
        calculation: action.affectsFacts ? undefined : state.calculation ? { ...state.calculation, revision: action.batch.revision } : undefined,
        pendingCalculation: undefined,
        calculationError: undefined,
        dirtyEditor: false,
        resultsReviewed: action.affectsFacts ? false : state.resultsReviewed,
        draftsReviewed: false,
        changes: [...state.changes, action.event],
        approvalHistory: invalidateCurrentApproval(state, action.batch.revision, changedAt),
        currentApprovalId: undefined,
        notice: `Saved as v${action.batch.revision}; current approval is no longer valid.`,
      }
    }
    case 'START_CALCULATION': return { ...state, status: 'calculating', pendingCalculation: action.pending, calculationError: undefined }
    case 'CALCULATION_SUCCEEDED': {
      const pending = state.pendingCalculation
      if (!pending || pending.batchId !== action.result.batchId || pending.revision !== action.result.revision || pending.requestId !== action.result.requestId) return state
      return { ...state, status: 'review', calculation: action.result, pendingCalculation: undefined, calculationError: undefined }
    }
    case 'CALCULATION_FAILED': {
      const pending = state.pendingCalculation
      if (!pending || pending.batchId !== action.pending.batchId || pending.revision !== action.pending.revision || pending.requestId !== action.pending.requestId) return state
      return { ...state, status: 'error', calculation: undefined, pendingCalculation: undefined, calculationError: action.message }
    }
    case 'RETRY_CALCULATION': return { ...state, status: 'calculating', calculation: undefined, pendingCalculation: undefined, calculationError: undefined, notice: 'Retrying current version.' }
    case 'MARK_RESULTS_REVIEWED': return { ...state, resultsReviewed: true, notice: 'Numeric results marked as reviewed.' }
    case 'MARK_DRAFTS_REVIEWED': return { ...state, draftsReviewed: true, notice: 'Drafts marked as reviewed. This does not send them.' }
    case 'APPROVE': {
      const blockers = approvalBlockers(state)
      if (blockers.length || action.snapshot.batchId !== state.batch.batchId || action.snapshot.revision !== state.batch.revision) {
        return { ...state, notice: `Approval refused: ${blockers[0] ?? 'snapshot does not match the current version'}` }
      }
      return { ...state, status: 'approved', approvalHistory: [...state.approvalHistory, action.snapshot], currentApprovalId: action.snapshot.approvalId, notice: `Approved v${action.snapshot.revision} for export and manual follow-up only.` }
    }
    case 'REVOKE_APPROVAL': return {
      ...state,
      status: 'review',
      approvalHistory: invalidateCurrentApproval(state, state.batch.revision, action.at),
      currentApprovalId: undefined,
      notice: 'Current approval revoked. Previously downloaded files cannot be recalled.',
    }
    case 'LOAD_WORKING_COPY': return action.state
    default: return state
  }
}

export function approvalBlockers(state: ReviewState): string[] {
  const blockers: string[] = []
  if (state.role !== 'manager') blockers.push('Manager role is required.')
  if (state.dirtyEditor) blockers.push('Save or cancel the open editor.')
  if (!state.batch.assumptions.confirmed) blockers.push('Confirm task assumptions.')
  blockers.push(...validateAssumptions(state.batch))
  if (state.status === 'calculating') blockers.push('Wait for current calculation.')
  if (state.status === 'error') blockers.push('Retry the failed calculation.')
  if (!state.calculation || state.calculation.revision !== state.batch.revision) blockers.push('Current calculation is not valid for this version.')
  if (state.calculation && state.calculation.includedCount === 0) blockers.push('At least one included record is required.')
  const hardBlockers = state.calculation?.matches.filter((match) => match.status === 'blocked').length ?? 0
  if (hardBlockers) blockers.push(`Resolve or exclude ${hardBlockers} blocked record${hardBlockers === 1 ? '' : 's'}.`)
  if (!state.resultsReviewed) blockers.push('Review numeric results.')
  if (!state.draftsReviewed) blockers.push('Review message drafts.')
  if (state.batch.drafts.some((draft) => draft.stale)) blockers.push('A hand-edited draft has stale source facts; adopt or edit it before review.')
  return [...new Set(blockers)]
}

export function canExport(state: ReviewState): boolean {
  const approval = state.approvalHistory.find((item) => item.approvalId === state.currentApprovalId)
  return Boolean(approval && !approval.invalidatedAt && approval.revision === state.batch.revision && state.status === 'approved' && !state.dirtyEditor)
}
