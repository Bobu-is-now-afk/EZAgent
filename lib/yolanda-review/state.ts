import { validateAssumptions } from './engine'
import type { ApprovalSnapshot, ChangeEvent, CalculationResult, EditorScope, PendingCalculation, ReviewBatch, ReviewState, Role } from './types'

export type ReviewAction =
  | { type: 'SET_ROLE'; role: Role }
  | { type: 'SET_EDITOR_DIRTY'; editor: EditorScope; dirty: boolean }
  | { type: 'COMMIT_BATCH'; batch: ReviewBatch; event: ChangeEvent; affectsFacts: boolean; editor?: EditorScope }
  | { type: 'START_CALCULATION'; pending: PendingCalculation }
  | { type: 'CALCULATION_SUCCEEDED'; result: CalculationResult }
  | { type: 'CALCULATION_FAILED'; pending: PendingCalculation; message: string }
  | { type: 'RETRY_CALCULATION' }
  | { type: 'MARK_RESULTS_REVIEWED' }
  | { type: 'MARK_DRAFTS_REVIEWED' }
  | { type: 'APPROVE'; approvalId: string; approvedAt: string }
  | { type: 'REVOKE_APPROVAL'; at: string }
  | { type: 'LOAD_WORKING_COPY'; batch: ReviewBatch; changes: ChangeEvent[]; notice: string }
  | { type: 'SET_NOTICE'; notice?: string }

function invalidateCurrentApproval(state: ReviewState, revision: number, at: string): ApprovalSnapshot[] {
  return state.approvalHistory.map((approval) => approval.approvalId === state.currentApprovalId
    ? { ...approval, invalidatedAt: at, invalidatedByRevision: revision }
    : approval)
}

export function createInitialState(batch: ReviewBatch): ReviewState {
  return {
    batch: structuredClone(batch),
    status: batch.mode === 'real' ? 'error' : 'draft',
    role: 'reviewer',
    identityMode: 'demo',
    dirtyEditors: [],
    resultsReviewed: false,
    draftsReviewed: false,
    changes: [],
    approvalHistory: [],
    ...(batch.mode === 'real' ? { calculationError: 'Real adapter is not connected. Synthetic calculation was not used.' } : {}),
  }
}

function setEditorDirty(editors: EditorScope[], editor: EditorScope, dirty: boolean): EditorScope[] {
  return dirty ? [...new Set([...editors, editor])] : editors.filter((item) => item !== editor)
}

function updateDraftSuggestions(batch: ReviewBatch, calculation: CalculationResult): ReviewBatch {
  const unresolved = calculation.matches.filter((match) => match.status === 'blocked').map((match) => match.recordId)
  const subject = `Receipt review follow-up — ${batch.batchId}`
  const body = unresolved.length
    ? `Hello,\n\nPlease review unresolved receipt items ${unresolved.join(', ')} in batch ${batch.batchId}. No message has been sent.\n\nRegards,\nFinance review team`
    : `Hello,\n\nBatch ${batch.batchId} has no unresolved receipt items. No message has been sent.\n\nRegards,\nFinance review team`
  return {
    ...batch,
    drafts: batch.drafts.map((draft) => draft.manuallyEdited
      ? { ...draft, stale: draft.basisRevision !== batch.revision, suggestedSubject: subject, suggestedBody: body }
      : { ...draft, subject, body, recordIds: unresolved, basisRevision: batch.revision, stale: false, suggestedSubject: undefined, suggestedBody: undefined }),
  }
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'SET_ROLE': return { ...state, role: action.role, notice: undefined }
    case 'SET_EDITOR_DIRTY': return { ...state, dirtyEditors: setEditorDirty(state.dirtyEditors, action.editor, action.dirty) }
    case 'SET_NOTICE': return { ...state, notice: action.notice }
    case 'COMMIT_BATCH': {
      const expectedRevision = state.batch.revision + 1
      if (action.batch.batchId !== state.batch.batchId || action.batch.revision !== expectedRevision || action.event.revision !== expectedRevision) {
        return { ...state, notice: `Save refused: next revision must be v${expectedRevision}.` }
      }
      const changedAt = action.event.at
      const drafts = action.affectsFacts
        ? action.batch.drafts.map((draft) => ({ ...draft, stale: true }))
        : action.batch.drafts
      return {
        ...state,
        batch: { ...action.batch, drafts },
        status: action.batch.mode === 'real' ? 'error' : action.affectsFacts ? 'calculating' : 'review',
        calculation: action.affectsFacts ? undefined : state.calculation ? { ...state.calculation, revision: action.batch.revision } : undefined,
        pendingCalculation: undefined,
        calculationError: action.batch.mode === 'real' ? 'Real adapter is not connected. Synthetic calculation was not used.' : undefined,
        dirtyEditors: action.editor ? setEditorDirty(state.dirtyEditors, action.editor, false) : state.dirtyEditors,
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
      return { ...state, batch: updateDraftSuggestions(state.batch, action.result), status: 'review', calculation: action.result, pendingCalculation: undefined, calculationError: undefined }
    }
    case 'CALCULATION_FAILED': {
      const pending = state.pendingCalculation
      if (!pending || pending.batchId !== action.pending.batchId || pending.revision !== action.pending.revision || pending.requestId !== action.pending.requestId) return state
      return { ...state, status: 'error', calculation: undefined, pendingCalculation: undefined, calculationError: action.message }
    }
    case 'RETRY_CALCULATION': return state.batch.mode === 'real'
      ? { ...state, status: 'error', calculation: undefined, pendingCalculation: undefined, calculationError: 'Real adapter is not connected. Synthetic calculation was not used.', notice: 'Retry refused: connect the real adapter first.' }
      : { ...state, status: 'calculating', calculation: undefined, pendingCalculation: undefined, calculationError: undefined, notice: 'Retrying current version.' }
    case 'MARK_RESULTS_REVIEWED': return state.status === 'review' && state.calculation?.revision === state.batch.revision
      ? { ...state, resultsReviewed: true, notice: 'Numeric results marked as reviewed.' }
      : { ...state, notice: 'Result review refused: current calculation is not ready.' }
    case 'MARK_DRAFTS_REVIEWED': return state.status === 'review' && state.calculation?.revision === state.batch.revision && !state.batch.drafts.some((draft) => draft.stale)
      ? { ...state, draftsReviewed: true, notice: 'Drafts marked as reviewed. This does not send them.' }
      : { ...state, notice: 'Draft review refused: current calculation and non-stale drafts are required.' }
    case 'APPROVE': {
      const blockers = approvalBlockers(state)
      if (blockers.length || !state.calculation) {
        return { ...state, notice: `Approval refused: ${blockers[0] ?? 'current calculation missing'}` }
      }
      const snapshot: ApprovalSnapshot = {
        approvalId: action.approvalId,
        batchId: state.batch.batchId,
        revision: state.batch.revision,
        approvedAt: action.approvedAt,
        approvedBy: state.identityMode === 'demo' ? 'demo-manager' : 'trusted-manager',
        identityMode: state.identityMode,
        batch: structuredClone(state.batch),
        calculation: structuredClone(state.calculation),
        changes: structuredClone(state.changes),
      }
      return { ...state, status: 'approved', approvalHistory: [...state.approvalHistory, snapshot], currentApprovalId: snapshot.approvalId, notice: `Approved v${snapshot.revision} for export and manual follow-up only.` }
    }
    case 'REVOKE_APPROVAL': {
      if (state.role !== 'manager' || !state.currentApprovalId) return { ...state, notice: 'Revocation refused: current manager role and approval are required.' }
      return {
        ...state,
        status: 'review',
        approvalHistory: invalidateCurrentApproval(state, state.batch.revision, action.at),
        currentApprovalId: undefined,
        notice: 'Current approval revoked. Previously downloaded files cannot be recalled.',
      }
    }
    case 'LOAD_WORKING_COPY': {
      const restored = createInitialState(action.batch)
      return { ...restored, status: action.batch.mode === 'real' ? 'error' : action.batch.assumptions.confirmed ? 'calculating' : 'draft', changes: action.changes, notice: action.notice }
    }
    default: return state
  }
}

export function approvalBlockers(state: ReviewState): string[] {
  const blockers: string[] = []
  if (state.role !== 'manager') blockers.push('Manager role is required.')
  if (state.dirtyEditors.length) blockers.push(`Save or cancel open editors: ${state.dirtyEditors.join(', ')}.`)
  if (!state.batch.assumptions.confirmed) blockers.push('Confirm task assumptions.')
  blockers.push(...validateAssumptions(state.batch))
  if (state.status === 'calculating') blockers.push('Wait for current calculation.')
  if (state.status === 'error') blockers.push('Retry the failed calculation.')
  if (!state.calculation || state.calculation.revision !== state.batch.revision) blockers.push('Current calculation is not valid for this version.')
  if (state.calculation && state.calculation.includedCount === 0) blockers.push('At least one included record is required.')
  const hardBlockers = state.calculation?.matches.filter((match) => match.status === 'blocked').length ?? 0
  if (hardBlockers) blockers.push(`Resolve or exclude ${hardBlockers} blocked record${hardBlockers === 1 ? '' : 's'}.`)
  const unacknowledgedWarnings = state.calculation?.matches.filter((match) => match.warnings.length && !state.batch.documents.find((document) => document.recordId === match.recordId)?.warningAcknowledgement?.reason.trim()).length ?? 0
  if (unacknowledgedWarnings) blockers.push(`Acknowledge ${unacknowledgedWarnings} warning${unacknowledgedWarnings === 1 ? '' : 's'} with reasons.`)
  if (!state.resultsReviewed) blockers.push('Review numeric results.')
  if (!state.draftsReviewed) blockers.push('Review message drafts.')
  if (state.batch.drafts.some((draft) => !draft.subject.trim() || !draft.body.trim())) blockers.push('Every exported draft requires a subject and body.')
  if (state.batch.drafts.some((draft) => draft.stale)) blockers.push('A hand-edited draft has stale source facts; adopt or edit it before review.')
  return [...new Set(blockers)]
}

export function canExport(state: ReviewState): boolean {
  const approval = state.approvalHistory.find((item) => item.approvalId === state.currentApprovalId)
  return Boolean(state.role === 'manager' && approval && !approval.invalidatedAt && approval.revision === state.batch.revision && state.status === 'approved' && !state.dirtyEditors.length)
}
