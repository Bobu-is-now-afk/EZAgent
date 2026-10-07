import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmWorkflow, confirmWorkflowPreviewParameter, organizeRequirement } from '../../lib/yolanda-review/workflow-config'
import { buildTrialRunCsv, canTrialRun, runReceiptJsonPreview } from '../../lib/yolanda-review/workflow-runner'

function confirmedReceiptWorkflow() {
  let config = organizeRequirement('Organize receipts and create a table. Ask when data is missing.', 'trial-workflow', 'en')
  config = confirmWorkflowPreviewParameter(config, 'dateInterpretation')
  config = confirmWorkflowPreviewParameter(config, 'acceptedCurrencies')
  config = confirmWorkflowPreviewParameter(config, 'missingMerchantHandling')
  return confirmWorkflow(config, '2026-10-07T00:00:00.000Z')
}

test('receipt preview requires a confirmed supported workflow', () => {
  const draft = organizeRequirement('Organize receipts.', 'draft', 'en')
  assert.equal(canTrialRun(draft).allowed, false)
  const custom = organizeRequirement('Register users.', 'custom', 'en')
  assert.equal(canTrialRun(custom).allowed, false)
})

test('receipt preview validates structured rows and reports partial failures', () => {
  const result = runReceiptJsonPreview(confirmedReceiptWorkflow(), JSON.stringify([
    { id: 'ok', date: '2026-10-07', merchant: 'North Pier Cafe', amount: '128.40', currency: 'hkd' },
    { id: 'bad', date: '09/10', merchant: '', amount: '-8' },
  ]), '2026-10-07T01:00:00.000Z')
  assert.equal(result.readyCount, 1)
  assert.equal(result.reviewCount, 1)
  assert.equal(result.rows[0].currency, 'HKD')
  assert.equal(result.rows[1].status, 'needs-review')
  assert.deepEqual(result.rows[1].issues, ['invalid-date', 'missing-merchant', 'invalid-amount', 'missing-currency'])
})

test('receipt preview rejects invalid containers, duplicate ids, and oversize batches', () => {
  const config = confirmedReceiptWorkflow()
  assert.throws(() => runReceiptJsonPreview(config, '{}'), /JSON array/)
  assert.throws(() => runReceiptJsonPreview(config, '[]'), /at least one row/)
  assert.throws(() => runReceiptJsonPreview(config, JSON.stringify([{ id: 7 }])), /id must be text/)
  assert.throws(() => runReceiptJsonPreview(config, JSON.stringify([{ id: 'same' }, { id: 'same' }])), /duplicate id/)
  assert.throws(() => runReceiptJsonPreview(config, JSON.stringify(Array.from({ length: 101 }, (_, index) => ({ id: String(index) })))), /100 rows/)
})

test('trial CSV prevents spreadsheet formulas while retaining row status', () => {
  const result = runReceiptJsonPreview(confirmedReceiptWorkflow(), JSON.stringify([
    { id: 'formula', date: '2026-10-07', merchant: '=HYPERLINK("bad")', amount: '1.00', currency: 'HKD' },
  ]))
  const csv = buildTrialRunCsv(result)
  assert.match(csv, /'=HYPERLINK/)
  assert.match(csv, /"ready"/)
})
