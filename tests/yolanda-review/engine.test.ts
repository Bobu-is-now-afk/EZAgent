import assert from 'node:assert/strict'
import test from 'node:test'
import { demoBatch } from '../../lib/yolanda-review/demo-data'
import { buildResultsCsv } from '../../lib/yolanda-review/export'
import { calculateBatch, parseMoneyToCents } from '../../lib/yolanda-review/engine'
import { approvalBlockers, createInitialState, reviewReducer } from '../../lib/yolanda-review/state'
import type { ApprovalSnapshot, ChangeEvent, ReviewBatch } from '../../lib/yolanda-review/types'

function confirmedBatch(): ReviewBatch {
  const batch = structuredClone(demoBatch)
  batch.assumptions.confirmed = true
  return batch
}

function event(revision: number): ChangeEvent {
  return { eventId: `event-${revision}`, at: '2026-10-03T00:00:00.000Z', actor: 'demo-reviewer', identityMode: 'demo', action: 'test', field: 'test', before: 'before', after: 'after', reason: 'test', revision }
}

test('A01: unconfirmed assumptions block approval', () => {
  const state = createInitialState(demoBatch)
  assert.match(approvalBlockers(state).join(' '), /Confirm task assumptions/)
})

test('money parsing is exact and rejects unsafe text', () => {
  assert.equal(parseMoneyToCents('86.50'), 8650)
  assert.equal(parseMoneyToCents('86.505'), undefined)
  assert.equal(parseMoneyToCents('=1+1'), undefined)
})

test('A04: one ledger row cannot serve two active matches', () => {
  const batch = confirmedBatch()
  batch.documents[3].corrections = { receiptNumber: 'R-1001' }
  batch.documents[3].selectedLedgerRowId = 'led-001'
  const result = calculateBatch(batch, 'collision')
  assert.ok(result.matches.some((match) => match.blockers.some((blocker) => blocker.includes('already used')) || match.blockers.some((blocker) => blocker.includes('duplicate'))))
})

test('A05: draft-only edit preserves numeric calculation while increasing revision', () => {
  const state = createInitialState(confirmedBatch())
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
  const snapshot = { approvalId: 'approval-test', batchId: state.batch.batchId, revision: state.batch.revision } as ApprovalSnapshot
  const next = reviewReducer(state, { type: 'APPROVE', snapshot })
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
  assert.equal(snapshot.batch.documents[0].corrections.merchant, ' \t=HYPERLINK("bad")')
})

test('A14: excluding every record produces no approvable result', () => {
  const batch = confirmedBatch()
  batch.documents = batch.documents.map((document) => ({ ...document, excluded: { reason: 'Test exclusion with retained evidence' } }))
  const state = createInitialState(batch)
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
