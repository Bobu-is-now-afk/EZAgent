import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateTotals, getMissingFields, initialDraft, isValidISODate, sourceAfterUserEdit, sourceSummaryBadge, suggestFromSource, toMinorUnits, type QuotationDraft } from '../../lib/documents/quotation'

const reviewedFixture: QuotationDraft = {
  ...initialDraft,
  sellerName: 'Sample Studio',
  buyerName: 'Demo Workshop Co',
  validUntil: '2026-11-30',
  currency: 'HKD',
  unitPrice: '1250.00',
  taxMode: 'none',
}

test('the exact synthetic source fixture is the only wording that receives a concept suggestion', () => {
  assert.deepEqual(suggestFromSource('Create a quote for two workshop days next month.'), {
    description: 'Workshop day', quantity: '2',
  })
  assert.deepEqual(suggestFromSource('  CREATE A QUOTE FOR TWO WORKSHOP DAYS NEXT MONTH.  '), {
    description: 'Workshop day', quantity: '2',
  }, 'the exact fixture can vary in case and surrounding whitespace')
})

test('unsupported count, Chinese wording, and negated requests stay blank and show honest source badges', () => {
  const unsupportedSources = [
    'Create a quote for three workshop days at HKD 900 per day. Reference JUDGE-732.',
    '請報價三天工作坊，每天港幣900元。',
    'Do not quote two workshop days. Quote three design sessions instead.',
  ]

  for (const source of unsupportedSources) {
    assert.deepEqual(suggestFromSource(source), { description: '', quantity: '' }, source)
  }

  assert.equal(sourceSummaryBadge('description', 'missing'), 'Description · no suggestion—enter manually')
  assert.equal(sourceSummaryBadge('quantity', 'missing'), 'Quantity · no suggestion—enter manually')
})

test('manual quantity edits replace suggestion provenance and update the source badge', () => {
  assert.equal(sourceSummaryBadge('quantity', 'concept-suggestion'), 'Quantity · suggested from source')
  const editedSource = sourceAfterUserEdit('3')
  assert.equal(editedSource, 'user')
  assert.equal(sourceSummaryBadge('quantity', editedSource), 'Quantity · entered manually')
  assert.equal(sourceSummaryBadge('quantity', sourceAfterUserEdit(' ')), 'Quantity · no suggestion—enter manually')
  assert.equal(sourceSummaryBadge('unitPrice', 'missing'), 'Price · no suggestion—enter manually')
  assert.equal(sourceSummaryBadge('unitPrice', sourceAfterUserEdit('900')), 'Price · entered manually')
})

test('custom wording suggestion fixture stays incomplete until missing facts are entered', () => {
  assert.deepEqual(getMissingFields(initialDraft), [
    'Seller name', 'Buyer name', 'Valid date (YYYY-MM-DD)', 'Currency', 'Non-negative unit price', 'Tax treatment',
  ])
  assert.equal(calculateTotals(initialDraft), null)
  assert.equal(calculateTotals({ ...initialDraft, unitPrice: '100', quantity: '2' }), null, 'unknown currency and tax treatment must not imply totals')
})

test('synthetic human-entered fixture calculates HKD 2,500.00 without a tax default', () => {
  assert.deepEqual(getMissingFields(reviewedFixture), [])
  assert.deepEqual(calculateTotals(reviewedFixture), { subtotalMinor: 250000, taxMinor: 0, totalMinor: 250000 })
})

test('integer minor-unit math rounds tax half up and rejects invalid money inputs', () => {
  assert.equal(toMinorUnits('1250.00'), 125000)
  assert.equal(toMinorUnits('-1'), null)
  assert.equal(toMinorUnits('1.999'), null)
  assert.deepEqual(calculateTotals({ ...reviewedFixture, quantity: '1', unitPrice: '0.05', taxMode: 'rate', taxRate: '10' }), {
    subtotalMinor: 5, taxMinor: 1, totalMinor: 6,
  })
})

test('invalid quantity and an unconfirmed tax treatment block the draft', () => {
  assert.ok(getMissingFields({ ...reviewedFixture, quantity: '1.5' }).includes('Positive whole-number quantity'))
  assert.ok(getMissingFields({ ...reviewedFixture, taxMode: '' }).includes('Tax treatment'))
  assert.ok(getMissingFields({ ...reviewedFixture, taxMode: 'rate', taxRate: '101' }).includes('Tax rate from 0 to 100% (up to 2 decimals)'))
  assert.ok(getMissingFields({ ...reviewedFixture, taxMode: 'rate', taxRate: '1.234' }).includes('Tax rate from 0 to 100% (up to 2 decimals)'))
  assert.equal(isValidISODate('2026-11-30'), true)
  assert.equal(isValidISODate('2026-02-30'), false)
  assert.equal(isValidISODate('next month'), false)
})

test('totals stop when tax would overflow safe integer minor units', () => {
  assert.equal(calculateTotals({
    ...reviewedFixture,
    quantity: '2',
    unitPrice: '45035996273704.95',
    taxMode: 'rate',
    taxRate: '100',
  }), null)
})
