import assert from 'node:assert/strict'
import test from 'node:test'

import { executeInvoiceWorkflow } from '../../lib/agent/executor'
import { createPlanner } from '../../lib/agent/planner'
import type { SourceType, WorkflowDefinition } from '../../lib/agent/contracts'

const proposal = {
  workflowType: 'invoice_filter_export',
  steps: [
    'parse_invoice_rows',
    'normalize_invoice_fields',
    'filter_invoice_rows',
    'validate_required_fields',
    'export_csv',
  ],
  requiredFields: ['invoice_id', 'customer', 'amount', 'currency'],
}

async function workflowFor(source: { name: string; type: SourceType; content: string }): Promise<WorkflowDefinition> {
  const planner = createPlanner({ fetcher: async () => Response.json({ message: { content: JSON.stringify(proposal) } }) })
  return (await planner.plan({
    goal: 'Find invoices above the threshold, flag missing fields, and export CSV.',
    source,
    parameters: { thresholdMinor: 1_000_000, currency: 'HKD' },
  })).workflow
}

test('invoice tools use strict minor-unit threshold, exact currency, and retain missing or malformed rows with refs', async () => {
  const source = {
    name: 'demo.csv',
    type: 'csv' as const,
    content: [
      'invoice_id,customer,amount,currency,description',
      'BELOW,Customer,9999.99,HKD,below',
      'EXACT,Customer,10000.00,HKD,exact boundary',
      'ABOVE,Customer,10000.01,HKD,above boundary',
      'OTHER,Customer,50000.00,USD,other currency',
      'OTHER-MISSING,,bad-amount,USD,do not mix',
      'MISSING,,9000.00,HKD,missing customer',
      'BAD-AMOUNT,Customer,nope,HKD,invalid amount',
      'BAD-CURRENCY,Customer,12000.00,HKD!,invalid currency',
      'MALFORMED,Customer,12000.00,HKD,extra cell,unexpected',
    ].join('\n'),
  }
  const workflow = await workflowFor(source)
  const result = executeInvoiceWorkflow(workflow, source)
  assert.deepEqual(result.taskOutcomes.map(({ tool, validation }) => [tool, validation.pass]), [
    ['parse_invoice_rows', true],
    ['normalize_invoice_fields', true],
    ['filter_invoice_rows', true],
    ['validate_required_fields', true],
    ['export_csv', true],
  ])
  for (const outcome of result.taskOutcomes) assert.ok(outcome.validation.evidence.length > 0)
  assert.match(result.taskOutcomes[0].validation.evidence.join(' '), /malformed row shapes retained/)
  assert.match(result.taskOutcomes[3].validation.evidence.join(' '), /row 7/)
  assert.match(result.csv, /"ABOVE"/)
  assert.match(result.csv, /"10000\.01"/)
  assert.doesNotMatch(result.csv, /"EXACT"|"BELOW"|"OTHER"|"OTHER-MISSING"/)
  assert.match(result.csv, /"MISSING".*"flagged: missing_customer"/)
  assert.match(result.csv, /"BAD-AMOUNT".*"flagged: invalid_amount"/)
  assert.match(result.csv, /"BAD-CURRENCY".*"flagged: invalid_currency"/)
  assert.match(result.csv, /"MALFORMED".*"flagged: malformed_row/)
  assert.ok(result.sourceRefs.some((reference) => 'rowNumber' in reference && reference.rowNumber === 4))
  assert.ok(result.sourceRefs.every((reference) => 'fileName' in reference && reference.fileName === source.name))
})

test('invoice tools parse supported TXT rows and retain one-based line references', async () => {
  const source = {
    name: 'demo.txt',
    type: 'text' as const,
    content: 'invoice_id|customer|amount|currency|description\nTXT-1|Customer|10000.01|HKD|above\nTXT-BAD|Customer|12000.00|HKD',
  }
  const workflow = await workflowFor({ ...source, type: 'text' })
  const result = executeInvoiceWorkflow(workflow, source)
  assert.equal(result.taskOutcomes.length, 5)
  assert.match(result.csv, /"TXT-1"/)
  assert.match(result.csv, /"TXT-BAD".*"flagged: malformed_row"/)
  assert.deepEqual(result.sourceRefs, [
    { fileName: 'demo.txt', lineNumber: 2 },
    { fileName: 'demo.txt', lineNumber: 3 },
  ])
})

test('CSV export neutralizes formula-leading source cells and quotes CSV syntax', async () => {
  const source = {
    name: 'formula.csv',
    type: 'csv' as const,
    content: 'invoice_id,customer,amount,currency,description\n=1+1,"  +cmd,""quoted""",12000.00,HKD,@SUM(1)',
  }
  const workflow = await workflowFor(source)
  const result = executeInvoiceWorkflow(workflow, source)
  assert.match(result.csv, /"'=1\+1"/)
  assert.match(result.csv, /"'\+cmd,\"\"quoted\"\""/)
  assert.match(result.csv, /"'@SUM\(1\)"/)
  assert.ok(result.taskOutcomes.at(-1)?.validation.evidence.some((evidence) => evidence.includes('formula-injection checks passed')))
})
