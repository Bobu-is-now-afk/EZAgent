import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlanner, validatePlanRequest, validateWorkflowForRun } from '../../lib/agent/planner'
import { executeInvoiceWorkflow } from '../../lib/agent/executor'
import {
  addWorkflowRule,
  confirmWorkflow,
  confirmWorkflowPreviewParameter,
  organizeRequirement,
  updateWorkflowPreviewParameter,
} from '../../lib/yolanda-review/workflow-config'
import { createInvoiceAgentHandoff } from '../../lib/yolanda-review/workflow-agent-handoff'

const source = {
  name: 'synthetic-invoices.csv',
  type: 'csv' as const,
  content: 'invoice_id,customer,amount,currency\nINV-1,Example Co,10000.01,HKD\n',
}

function confirmedInvoice() {
  let config = organizeRequirement('Filter invoices above a confirmed amount, flag missing fields, and export CSV.', 'invoice-workflow', 'en')
  config = confirmWorkflowPreviewParameter(config, 'invoiceThresholdMinor')
  config = confirmWorkflowPreviewParameter(config, 'acceptedCurrencies')
  config = confirmWorkflowPreviewParameter(config, 'missingMerchantHandling')
  return confirmWorkflow(config, '2026-10-11T00:00:00.000Z')
}

test('confirmed invoice workflow maps exact minor units and currency into the existing Planner contract', () => {
  const config = updateWorkflowPreviewParameter(confirmedInvoice(), 'invoiceThresholdMinor', 875_050)
  const reconfirmed = confirmWorkflow(config, '2026-10-11T00:01:00.000Z')
  const handoff = createInvoiceAgentHandoff(reconfirmed, 'en')

  assert.equal(handoff.status, 'ready')
  assert.deepEqual(handoff.parameters, { thresholdMinor: 875_050, currency: 'HKD' })
  assert.equal(handoff.workflowId, config.workflowId)
  assert.equal(handoff.revision, reconfirmed.revision)
  assert.match(handoff.summary, /strictly above HKD 8,750\.50/)
  assert.equal(validatePlanRequest({ goal: reconfirmed.goal, source, parameters: handoff.parameters }).ok, true)
})

test('multiple currencies and arbitrary rules block a complete-workflow handoff instead of being ignored', () => {
  let config = updateWorkflowPreviewParameter(confirmedInvoice(), 'acceptedCurrencies', ['HKD', 'USD'])
  config = addWorkflowRule(config, 'process', 'Email the finance director after every run.', 'custom-send-rule')
  config = confirmWorkflow(config, '2026-10-11T00:02:00.000Z')
  const handoff = createInvoiceAgentHandoff(config, 'en')

  assert.equal(handoff.status, 'blocked')
  assert.ok(handoff.blockers.some((value) => /one exact currency/i.test(value)))
  assert.ok(handoff.unsupportedRequirements.some((value) => value.id === 'custom-send-rule'))
  assert.equal(handoff.parameters, null)
})

test('unsupported actions in the initial invoice request are retained and block handoff', () => {
  let config = organizeRequirement('Filter invoices above HKD 10,000, email finance, and export CSV.', 'invoice-email', 'en')
  config = confirmWorkflowPreviewParameter(config, 'missingMerchantHandling')
  config = confirmWorkflow(config, '2026-10-11T00:02:30.000Z')
  const handoff = createInvoiceAgentHandoff(config, 'en')

  assert.equal(handoff.status, 'blocked')
  assert.ok(handoff.unsupportedRequirements.some((value) => /email finance/i.test(value.text)))
  assert.ok(handoff.blockers.some((value) => /not be silently ignored/i.test(value)))
})

test('invoice missing-field policy cannot be relaxed through a preview-only option', () => {
  let config = updateWorkflowPreviewParameter(confirmedInvoice(), 'missingMerchantHandling', 'keep-empty-marked')
  config = confirmWorkflow(config, '2026-10-11T00:02:45.000Z')
  const handoff = createInvoiceAgentHandoff(config, 'en')

  assert.equal(handoff.status, 'blocked')
  assert.ok(handoff.blockers.some((value) => /fixed policy/i.test(value)))
})

test('receipt date interpretation remains explicit unsupported scope for the invoice Agent', () => {
  let config = organizeRequirement('Organize receipts and interpret numeric dates.', 'receipt-workflow', 'en')
  config = confirmWorkflowPreviewParameter(config, 'dateInterpretation')
  config = confirmWorkflowPreviewParameter(config, 'acceptedCurrencies')
  config = confirmWorkflowPreviewParameter(config, 'missingMerchantHandling')
  config = confirmWorkflow(config, '2026-10-11T00:03:00.000Z')
  const handoff = createInvoiceAgentHandoff(config, 'en')

  assert.equal(handoff.status, 'not-supported')
  assert.ok(handoff.unsupportedRequirements.some((value) => /date/i.test(value.reason)))
  assert.equal(handoff.parameters, null)
})

test('changing the Builder threshold changes the real Planner workflow and exported CSV', async () => {
  const planner = createPlanner({ fetcher: async () => new Response(JSON.stringify({
    message: { content: JSON.stringify({
      workflowType: 'invoice_filter_export',
      steps: ['parse_invoice_rows', 'normalize_invoice_fields', 'filter_invoice_rows', 'validate_required_fields', 'export_csv'],
      requiredFields: ['invoice_id', 'customer', 'amount', 'currency'],
    }) },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }) })
  const executionSource = {
    name: 'synthetic-threshold.csv',
    type: 'csv' as const,
    content: 'invoice_id,customer,amount,currency\nINV-LOW,Example A,10500.00,HKD\nINV-HIGH,Example B,12500.00,HKD\n',
  }
  const makeHandoff = (thresholdMinor: number) => {
    const changed = updateWorkflowPreviewParameter(confirmedInvoice(), 'invoiceThresholdMinor', thresholdMinor)
    return createInvoiceAgentHandoff(confirmWorkflow(changed), 'en')
  }
  const low = makeHandoff(1_000_000)
  const high = makeHandoff(1_200_000)
  assert.ok(low.parameters && high.parameters)
  const lowPlan = await planner.plan({ goal: low.goal, source: executionSource, parameters: low.parameters })
  const highPlan = await planner.plan({ goal: high.goal, source: executionSource, parameters: high.parameters })
  const lowCsv = executeInvoiceWorkflow(lowPlan.workflow, executionSource).csv
  const highCsv = executeInvoiceWorkflow(highPlan.workflow, executionSource).csv

  assert.match(lowCsv, /INV-LOW/)
  assert.match(lowCsv, /INV-HIGH/)
  assert.doesNotMatch(highCsv, /INV-LOW/)
  assert.match(highCsv, /INV-HIGH/)
  assert.equal(validateWorkflowForRun({ ...lowPlan.workflow, origin: { type: 'yolanda-builder', workflowId: low.workflowId, revision: low.revision } }, executionSource).ok, true)
})
