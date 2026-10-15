import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeDocumentTotals, formatMinorUnits, parseMinorUnits } from '../../lib/documents/money'
import { validateSuggestionFields } from '../../lib/documents/suggestion'
import { createDocumentStore, DocumentStoreError } from '../../lib/documents/store'
import { parseDraftPatch, parseOrderWrite, reviewableFieldPaths } from '../../lib/documents/validation'

async function storeFor(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'ezagent-documents-test-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  return { root, store: await createDocumentStore(root) }
}

function orderInput(overrides: Record<string, unknown> = {}) {
  return {
    buyer: { name: 'Sample Buyer', address: null, contact: null },
    currency: 'HKD',
    items: [{ name: 'Consulting', description: null, quantity: 2, unitPrice: '12.34' }],
    agreedDate: '2026-10-01', termsText: 'Delivery after acceptance',
    sourceReferenceId: 'internal-demo', sourceReferenceVersion: '1', ...overrides,
  }
}

function valid<T>(value: T | null): T {
  assert.ok(value)
  return value
}

function runDocumentChild(mode: 'order' | 'sample' | 'clear', root: string, args: string[] = []): Promise<void> {
  const storeModule = path.resolve(__dirname, '../../lib/documents/store.js')
  const validationModule = path.resolve(__dirname, '../../lib/documents/validation.js')
  const childSource = `
    const { createDocumentStore } = require(${JSON.stringify(storeModule)});
    const { parseOrderWrite } = require(${JSON.stringify(validationModule)});
    (async () => {
      const store = await createDocumentStore(process.argv[1]);
      const mode = process.argv[2];
      if (mode === 'order') {
        const parsed = parseOrderWrite(${JSON.stringify(orderInput())}, false);
        if (!parsed) throw new Error('invalid synthetic test input');
        await store.createOrder(parsed.input);
      } else if (mode === 'sample') {
        await store.createSample(process.argv[3], Number(process.argv[4]), process.argv[5], process.argv[6]);
      } else if (mode === 'clear') {
        await store.clearData();
      }
    })().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
  `
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['-e', childSource, root, mode, ...args], { stdio: 'ignore' })
    child.once('error', rejectRun)
    child.once('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`document child exited with ${code}`)))
  })
}

test('money parser and totals reject unsupported or inexact values', () => {
  assert.equal(parseMinorUnits('12.34', 'HKD'), 1234)
  assert.equal(parseMinorUnits('0.5', 'TWD'), 50)
  for (const [value, currency] of [['1.001', 'HKD'], ['1e2', 'HKD'], ['-1', 'HKD'], ['1', 'USD'], ['10000000001', 'HKD']] as const) {
    assert.equal(parseMinorUnits(value, currency), null)
  }
  assert.equal(formatMinorUnits(1234, 'HKD'), '12.34')
  assert.equal(formatMinorUnits(-1, 'HKD'), null)
  assert.deepEqual(computeDocumentTotals({ currency: 'HKD', items: [], taxMode: 'none', taxRateBasisPoints: null }), {
    subtotalMinor: null, taxMinor: null, totalMinor: null, currency: 'HKD',
  })
  const base = { currency: 'HKD', items: [{ id: 'item-1', name: 'Service', description: null, quantity: 2, unitPriceMinor: 1234 }], taxMode: 'excluded' as const, taxRateBasisPoints: 500 }
  assert.deepEqual(computeDocumentTotals(base), { subtotalMinor: 2468, taxMinor: 123, totalMinor: 2591, currency: 'HKD' })
  assert.equal(computeDocumentTotals({ ...base, taxRateBasisPoints: 10_001 }).totalMinor, null)
  assert.equal(computeDocumentTotals({ ...base, taxMode: 'none', taxRateBasisPoints: 5 }).totalMinor, null)
  assert.equal(computeDocumentTotals({ ...base, items: [{ id: 'item-1', name: 'Service', description: null, quantity: 1_000_000, unitPriceMinor: 1_000_000_000_000 }] }).totalMinor, null)
})

test('write validators enforce the documented currency, quantity, and suggestion boundaries', () => {
  assert.ok(parseOrderWrite(orderInput(), false))
  assert.equal(parseOrderWrite(orderInput({ currency: 'USD' }), false), null)
  assert.equal(parseOrderWrite(orderInput({ items: [{ name: 'x', description: null, quantity: 1.5, unitPrice: '1.00' }] }), false), null)
  assert.equal(parseOrderWrite(orderInput({ items: [{ name: 'x', description: null, quantity: 1, unitPrice: '1.001' }] }), false), null)
  const repeatedId = '10000000-0000-4000-8000-000000000001'
  assert.equal(parseDraftPatch({ expectedRevision: 1, items: [
    { id: repeatedId, name: 'x', description: null, quantity: 1, unitPrice: '1.00' },
    { id: repeatedId, name: 'y', description: null, quantity: 1, unitPrice: '2.00' },
  ] }, 'HKD'), null)
  assert.deepEqual(validateSuggestionFields({ fields: [{ path: 'termsText', value: 'Deliver after acceptance', sourceExcerpt: 'delivery after approval' }] }, 'Please use delivery after approval.'), [
    { path: 'termsText', value: 'Deliver after acceptance', sourceExcerpt: 'delivery after approval' },
  ])
  for (const proposal of [
    { fields: [{ path: 'currency', value: 'USD', sourceExcerpt: 'USD' }] },
    { fields: [{ path: 'termsText', value: 'Net 30', sourceExcerpt: 'not in source' }] },
    { fields: [{ path: 'termsText', value: 'Net 30', sourceExcerpt: 'source' }], extra: true },
  ]) assert.equal(validateSuggestionFields(proposal, 'source'), null)
  assert.equal(validateSuggestionFields({ fields: [{ path: 'items[].description', value: 'Workshop — HKD 999 payable to account 1234', sourceExcerpt: 'two workshop days' }] }, 'two workshop days'), null)
  assert.equal(validateSuggestionFields({ fields: [{ path: 'items[].description', value: 'Workshop HKD 999 payable to account 1234', sourceExcerpt: 'Budget HKD 9999 for workshop account 1234' }] }, 'Budget HKD 9999 for workshop account 1234'), null)
})

test('order revisions remain immutable and referenced order deletion archives', async (t) => {
  const { store } = await storeFor(t)
  const input = valid(parseOrderWrite(orderInput(), false)).input
  const order = await store.createOrder(input)
  const draft = await store.createDraft('invoice', { id: order.id, revision: 1 })
  const update = valid(parseOrderWrite({ ...orderInput({ termsText: 'Updated terms' }), expectedRevision: 1 }, true)).input
  const revised = await store.updateOrder(order.id, 1, update)
  assert.equal(revised.revision, 2)
  assert.equal((await store.getOrder(order.id, 1)).order.termsText, 'Delivery after acceptance')
  await assert.rejects(store.reviewDraft(draft.id, draft.revision, []), (error: unknown) => error instanceof DocumentStoreError && error.code === 'source_order_changed')
  const archived = await store.deleteOrArchiveOrder(order.id, 2)
  assert.equal(archived.deleted, false)
  assert.equal(archived.order?.status, 'archived')
})

test('draft provenance survives unchanged fields, review is exact, samples are idempotent, and clear keeps sequence', async (t) => {
  const { store } = await storeFor(t)
  const order = await store.createOrder(valid(parseOrderWrite(orderInput(), false)).input)
  const draft = await store.createDraft('invoice', { id: order.id, revision: 1 })
  const parsedPatch = valid(parseDraftPatch({
    expectedRevision: 1,
    buyer: { name: 'Sample Buyer', address: '1 Demo Road', contact: null },
    items: [{ id: draft.items[0].id, name: 'Consulting', description: null, quantity: 2, unitPrice: '12.34' }],
    issueDate: '2026-10-15', taxMode: 'none', taxRateBasisPoints: null,
  }, draft.currency))
  const patched = await store.patchDraft(draft.id, parsedPatch.expectedRevision, parsedPatch.patch)
  assert.equal(patched.provenance['items[0].name'].source, 'order')
  assert.equal(patched.provenance['buyer.address'].source, 'user')
  const paths = reviewableFieldPaths(patched)
  await assert.rejects(store.reviewDraft(patched.id, patched.revision, paths.slice(1)), (error: unknown) => error instanceof DocumentStoreError && error.code === 'review_confirmation_mismatch')
  const review = await store.reviewDraft(patched.id, patched.revision, paths)
  const sample1 = await store.createSample(patched.id, review.draft.revision, review.digest, 'test-idempotency-key-0001')
  const retry = await store.createSample(patched.id, review.draft.revision, review.digest, 'test-idempotency-key-0001')
  assert.equal(sample1.created, true)
  assert.equal(retry.created, false)
  assert.equal(retry.value.sampleNumber, sample1.value.sampleNumber)
  assert.equal(sample1.value.status, 'SAMPLE / NOT FOR PAYMENT')
  await store.clearData()
  const freshOrder = await store.createOrder(valid(parseOrderWrite(orderInput(), false)).input)
  const freshDraft = await store.createDraft('invoice', { id: freshOrder.id, revision: 1 })
  const fresh = valid(parseDraftPatch({ expectedRevision: 1, issueDate: '2026-10-15', taxMode: 'none' }, freshDraft.currency))
  const completed = await store.patchDraft(freshDraft.id, fresh.expectedRevision, fresh.patch)
  const secondReview = await store.reviewDraft(completed.id, completed.revision, reviewableFieldPaths(completed))
  const secondSample = await store.createSample(completed.id, completed.revision, secondReview.digest, 'test-idempotency-key-0002')
  assert.notEqual(secondSample.value.sampleNumber, sample1.value.sampleNumber)
})

test('separate local processes serialize order writes, sample numbering, idempotency, and clear', async (t) => {
  const { root, store } = await storeFor(t)
  const orderWrites = Array.from({ length: 12 }, () => runDocumentChild('order', root))
  await Promise.all(orderWrites)
  const orders = await store.listOrders()
  assert.equal(orders.length, 12)

  const reviewed = []
  for (const order of orders) {
    const draft = await store.createDraft('invoice', { id: order.id, revision: 1 })
    const patch = valid(parseDraftPatch({ expectedRevision: 1, issueDate: '2026-10-15', taxMode: 'none' }, draft.currency))
    const updated = await store.patchDraft(draft.id, patch.expectedRevision, patch.patch)
    const review = await store.reviewDraft(updated.id, updated.revision, reviewableFieldPaths(updated))
    reviewed.push({ id: updated.id, revision: updated.revision, digest: review.digest })
  }
  const sampleWrites = reviewed.map((draft, index) => runDocumentChild('sample', root, [
    draft.id, String(draft.revision), draft.digest, `race-sample-key-${String(index).padStart(4, '0')}`,
  ]))
  await Promise.all(sampleWrites)
  const samples = await store.listSamples()
  assert.equal(samples.length, 12)
  assert.equal(new Set(samples.map((sample) => sample.sampleNumber)).size, 12)

  const first = reviewed[0]
  const firstKey = 'race-sample-key-0000'
  await Promise.all([
    runDocumentChild('sample', root, [first.id, String(first.revision), first.digest, firstKey]),
    runDocumentChild('sample', root, [first.id, String(first.revision), first.digest, firstKey]),
  ])
  assert.equal((await store.listSamples()).length, 12)

  await runDocumentChild('clear', root)
  assert.equal((await store.listOrders()).length, 0)
  assert.equal((await store.listSamples()).length, 0)
})
