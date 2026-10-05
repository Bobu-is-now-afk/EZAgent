import assert from 'node:assert/strict'
import test from 'node:test'
import { demoBatch } from '../../lib/yolanda-review/demo-data'
import { buildResultsCsv, buildWorkingCopy } from '../../lib/yolanda-review/export'
import { calculateBatch, parseIsoDay, parseMoneyToCents, validateAssumptions } from '../../lib/yolanda-review/engine'
import { approvalBlockers, canExport, createInitialState, reviewReducer } from '../../lib/yolanda-review/state'
import type { ApprovalSnapshot, ChangeEvent, ReviewBatch } from '../../lib/yolanda-review/types'
import { parseWorkingCopy } from '../../lib/yolanda-review/working-copy'

function confirmedBatch(): ReviewBatch {
  const batch = structuredClone(demoBatch)
  batch.assumptions.confirmed = true
  return batch
}

function event(revision: number): ChangeEvent {
  return { eventId: `event-${revision}`, at: '2026-10-03T00:00:00.000Z', actor: 'demo-reviewer', identityMode: 'demo', action: 'test', field: 'test', before: 'before', after: 'after', reason: 'test', revision }
}

function calculatedState(batch: ReviewBatch) {
  const pending = { batchId: batch.batchId, revision: batch.revision, requestId: `calc-${batch.revision}` }
  const calculating = reviewReducer(createInitialState(batch), { type: 'START_CALCULATION', pending })
  return reviewReducer(calculating, { type: 'CALCULATION_SUCCEEDED', result: calculateBatch(batch, pending.requestId) })
}

test('A01: unconfirmed assumptions block approval', () => {
  const state = createInitialState(demoBatch)
  assert.match(approvalBlockers(state).join(' '), /Confirm task assumptions/)
})

test('money parsing is exact and rejects unsafe text', () => {
  assert.equal(parseMoneyToCents('86.50'), 8650)
  assert.equal(parseMoneyToCents('86.505'), undefined)
  assert.equal(parseMoneyToCents('=1+1'), undefined)
  assert.equal(parseIsoDay('2026-02-29'), undefined)
  assert.notEqual(parseIsoDay('2026-02-28'), undefined)
})

test('A03: unsupported synthetic mapping is rejected instead of fake-recalculated', () => {
  const batch = confirmedBatch()
  batch.assumptions.fieldMapping.amount = 'vendor_name'
  assert.match(validateAssumptions(batch).join(' '), /cannot recalculate this field mapping/)
})

test('confirmed date range blocks out-of-range documents', () => {
  const batch = confirmedBatch()
  batch.documents[0].corrections.date = '2026-10-01'
  assert.match(calculateBatch(batch, 'range').matches[0].blockers.join(' '), /outside the confirmed task range/)
})

test('manual unmatch remains pending instead of silently auto-matching again', () => {
  const batch = confirmedBatch()
  batch.documents[0].matchDisposition = 'pending'
  const match = calculateBatch(batch, 'pending').matches[0]
  assert.equal(match.selectedLedgerRowId, undefined)
  assert.match(match.blockers.join(' '), /marked pending review/)
})

test('A04: one ledger row cannot serve two active matches', () => {
  const batch = confirmedBatch()
  batch.documents[3].corrections = { receiptNumber: 'R-1001' }
  batch.documents[3].selectedLedgerRowId = 'led-001'
  const result = calculateBatch(batch, 'collision')
  assert.ok(result.matches.some((match) => match.blockers.some((blocker) => blocker.includes('already used')) || match.blockers.some((blocker) => blocker.includes('duplicate'))))
})

test('A05: draft-only edit preserves numeric calculation while increasing revision', () => {
  const state = calculatedState(confirmedBatch())
  const nextBatch = structuredClone(state.batch)
  nextBatch.revision++
  nextBatch.drafts[0].body = 'Edited only'
  const next = reviewReducer(state, { type: 'COMMIT_BATCH', batch: nextBatch, event: event(nextBatch.revision), affectsFacts: false })
  assert.equal(next.batch.revision, 2)
  assert.equal(next.calculation?.totalCents, state.calculation?.totalCents)
  assert.equal(next.calculation?.revision, 2)
  assert.equal(next.draftsReviewed, false)
})

test('A07: stale asynchronous result is ignored', () => {
  const state = createInitialState(confirmedBatch())
  const pending = { batchId: state.batch.batchId, revision: state.batch.revision, requestId: 'new' }
  const calculating = reviewReducer(state, { type: 'START_CALCULATION', pending })
  const stale = calculateBatch(state.batch, 'old')
  assert.equal(reviewReducer(calculating, { type: 'CALCULATION_SUCCEEDED', result: stale }), calculating)
})

test('A09: reducer refuses approval from reviewer', () => {
  const state = createInitialState(confirmedBatch())
  const next = reviewReducer(state, { type: 'APPROVE', approvalId: 'approval-test', approvedAt: '2026-10-03T00:00:00Z' })
  assert.equal(next.currentApprovalId, undefined)
  assert.match(next.notice ?? '', /Approval refused/)
})

test('A12: CSV protects formula prefixes but JSON source can retain raw text', () => {
  const batch = confirmedBatch()
  batch.documents[0].corrections.merchant = ' \t=HYPERLINK("bad")'
  const calculation = calculateBatch(batch, 'csv')
  const snapshot = { approvalId: 'a', batchId: batch.batchId, revision: batch.revision, approvedAt: '2026-10-03T00:00:00Z', approvedBy: 'demo-manager', identityMode: 'demo', batch, calculation, changes: [] } satisfies ApprovalSnapshot
  const csv = buildResultsCsv(snapshot)
  assert.match(csv, /'\s*=HYPERLINK/)
  assert.match(csv, /"approvalId","approvalRevision"/)
  assert.match(csv, /"originalMerchant","reviewedMerchant"/)
  assert.equal(snapshot.batch.documents[0].corrections.merchant, ' \t=HYPERLINK("bad")')
})

test('A14: excluding every record produces no approvable result', () => {
  const batch = confirmedBatch()
  batch.documents = batch.documents.map((document) => ({ ...document, excluded: { reason: 'Test exclusion with retained evidence' } }))
  const state = calculatedState(batch)
  state.role = 'manager'
  state.resultsReviewed = true
  state.draftsReviewed = true
  assert.equal(state.calculation?.includedCount, 0)
  assert.match(approvalBlockers(state).join(' '), /At least one included record/)
})

test('A18: fact changes preserve a hand-edited draft and mark it stale', () => {
  const state = createInitialState(confirmedBatch())
  state.batch.drafts[0].body = 'Hand-written text'
  state.batch.drafts[0].manuallyEdited = true
  const nextBatch = structuredClone(state.batch)
  nextBatch.revision++
  nextBatch.documents[0].corrections.amount = '128.41'
  const next = reviewReducer(state, { type: 'COMMIT_BATCH', batch: nextBatch, event: event(nextBatch.revision), affectsFacts: true })
  assert.equal(next.batch.drafts[0].body, 'Hand-written text')
  assert.equal(next.batch.drafts[0].stale, true)
})

test('scoped dirty state cannot be cleared by saving another editor', () => {
  let state = calculatedState(confirmedBatch())
  state = reviewReducer(state, { type: 'SET_EDITOR_DIRTY', editor: 'draft', dirty: true })
  state = reviewReducer(state, { type: 'SET_EDITOR_DIRTY', editor: 'match', dirty: true })
  const batch = structuredClone(state.batch)
  batch.revision++
  batch.documents[0].matchReason = 'Reviewed match'
  state = reviewReducer(state, { type: 'COMMIT_BATCH', batch, event: event(batch.revision), affectsFacts: true, editor: 'match' })
  assert.deepEqual(state.dirtyEditors, ['draft'])
  assert.match(approvalBlockers(state).join(' '), /open editors: draft/)
})

test('revision must increase by exactly one', () => {
  const state = createInitialState(confirmedBatch())
  const batch = structuredClone(state.batch)
  batch.revision += 2
  const next = reviewReducer(state, { type: 'COMMIT_BATCH', batch, event: event(batch.revision), affectsFacts: true })
  assert.equal(next.batch.revision, state.batch.revision)
  assert.match(next.notice ?? '', /Save refused/)
})

test('manager-only export and revocation remain enforced after approval', () => {
  const batch = confirmedBatch()
  batch.documents = [batch.documents[0]]
  batch.evidence = [batch.evidence[0]]
  batch.ledgerRows = [batch.ledgerRows[0]]
  batch.drafts[0].recordIds = [batch.documents[0].recordId]
  let state = calculatedState(batch)
  state.role = 'manager'
  state.resultsReviewed = true
  state.draftsReviewed = true
  state = reviewReducer(state, { type: 'APPROVE', approvalId: 'approval-role', approvedAt: '2026-10-05T00:00:00Z' })
  assert.equal(canExport(state), true)
  state = reviewReducer(state, { type: 'SET_ROLE', role: 'reviewer' })
  assert.equal(canExport(state), false)
  const refused = reviewReducer(state, { type: 'REVOKE_APPROVAL', at: '2026-10-05T00:01:00Z' })
  assert.equal(refused.currentApprovalId, 'approval-role')
  assert.match(refused.notice ?? '', /Revocation refused/)
})

test('warning requires a reason before approval', () => {
  const batch = confirmedBatch()
  batch.documents = [batch.documents[7]]
  batch.evidence = [batch.evidence[7]]
  batch.ledgerRows = [batch.ledgerRows.find((row) => row.ledgerRowId === 'led-008')!]
  batch.drafts[0].recordIds = [batch.documents[0].recordId]
  const state = calculatedState(batch)
  assert.match(approvalBlockers({ ...state, role: 'manager', resultsReviewed: true, draftsReviewed: true }).join(' '), /Acknowledge 1 warning/)
})

test('working copy validation sanitizes history and rejects broken references', () => {
  const state = createInitialState(demoBatch)
  state.changes = [event(1)]
  const parsed = parseWorkingCopy(JSON.parse(buildWorkingCopy(state)))
  assert.equal(parsed.changes[0].actor, 'imported-untrusted')
  assert.equal(parsed.changes[0].identityMode, 'demo')
  const broken = JSON.parse(buildWorkingCopy(state))
  broken.batch.documents[0].evidenceId = 'missing'
  assert.throws(() => parseWorkingCopy(broken), /missing evidence/)
})

test('real-mode input never falls back to synthetic calculation state', () => {
  const batch = confirmedBatch()
  batch.mode = 'real'
  let state = createInitialState(batch)
  assert.equal(state.status, 'error')
  assert.match(state.calculationError ?? '', /Real adapter is not connected/)
  state = reviewReducer(state, { type: 'RETRY_CALCULATION' })
  assert.equal(state.status, 'error')
  assert.equal(state.pendingCalculation, undefined)
})

test('results and drafts cannot be reviewed before current calculation', () => {
  let state = createInitialState(confirmedBatch())
  state = reviewReducer(state, { type: 'MARK_RESULTS_REVIEWED' })
  state = reviewReducer(state, { type: 'MARK_DRAFTS_REVIEWED' })
  assert.equal(state.resultsReviewed, false)
  assert.equal(state.draftsReviewed, false)
})
