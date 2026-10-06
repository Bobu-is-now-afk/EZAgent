import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLogicPills, deriveLogicPills, isLogicPills } from '../../lib/agent/logic-pills'
import { validateWorkflow } from '../../lib/agent/validation'
import type { WorkflowDefinition } from '../../lib/agent/contracts'

const workflow: WorkflowDefinition = {
  version: 1, goal: 'Check a synthetic table',
  parameters: { thresholdMinor: 100, currency: 'HKD' },
  allowedTools: ['filter_invoice_rows'],
  acceptance: [{ id: 'min', type: 'minimum_amount_minor', thresholdMinor: 100 }],
  steps: [{ id: 'filter', tool: 'filter_invoice_rows', dependencies: [], inputRefs: ['source'], parameters: { thresholdMinor: 100, currency: 'HKD' }, acceptance: [{ id: 'min', type: 'minimum_amount_minor', thresholdMinor: 100 }] }],
}

test('typed pills accept multiple domains and reject malformed or duplicate IDs', () => {
  const pills = [
    { id: 'clinic', label: 'Follow-up', type: 'tags', value: ['weekly'] },
    { id: 'claims', label: 'Format', type: 'select', value: 'CSV', options: ['CSV', 'TXT'] },
    { id: 'note', label: 'Instructions', type: 'text', value: 'Check format' },
    { id: 'count', label: 'Count', type: 'number', value: 2 },
  ]
  assert.equal(isLogicPills(pills), true)
  assert.equal(isLogicPills([...pills, pills[0]]), false)
  assert.equal(isLogicPills([{ ...pills[3], value: Number.NaN }]), false)
  assert.equal(isLogicPills([{ ...pills[1], value: 'PDF' }]), false)
})

test('bound edits update tool, global parameters and acceptance without mutating the proposal', () => {
  const pills = deriveLogicPills(workflow).map(p => p.type === 'number' ? { ...p, value: 200 } : p)
  const result = applyLogicPills(workflow, pills)
  assert.deepEqual(result.errors, [])
  assert.equal(result.workflow.parameters.thresholdMinor, 200)
  assert.equal(result.workflow.steps[0].parameters?.thresholdMinor, 200)
  assert.deepEqual(result.workflow.acceptance, [{ id: 'min', type: 'minimum_amount_minor', thresholdMinor: 200 }])
  assert.equal(workflow.parameters.thresholdMinor, 100)
  assert.equal(validateWorkflow(result.workflow).ok, true)
})

test('deleting required controls cannot silently use old parameters', () => {
  const result = applyLogicPills(workflow, [])
  assert.equal(result.errors.length, 2)
  assert.equal(result.workflow.steps[0].parameters?.thresholdMinor, undefined)
  assert.equal(validateWorkflow(result.workflow).ok, false)
})

test('bound pill type must match its tool parameter type and deleting export columns is an error', () => {
  const pills = deriveLogicPills(workflow)
  const wrongType = pills.map((pill) => pill.id === 'step:filter:currency'
    ? { ...pill, type: 'select' as const, options: ['HKD'] }
    : pill)
  assert.ok(applyLogicPills(workflow, wrongType).errors.some((error) => error.includes('參數型別不相容')))

  const invoiceWorkflow: WorkflowDefinition = {
    ...workflow,
    steps: [
      ...workflow.steps,
      { id: 'export', tool: 'export_csv', dependencies: ['filter'], inputRefs: ['filter'], parameters: { columns: ['invoice_id', 'amount', 'currency', 'source_file', 'source_row', 'validation_status'] }, acceptance: [] },
    ],
  }
  const withoutColumns = deriveLogicPills(invoiceWorkflow).filter((pill) => pill.id !== 'step:export:columns')
  assert.ok(applyLogicPills(invoiceWorkflow, withoutColumns).errors.some((error) => error.includes('缺少工具參數')))
})

test('custom pills survive serialization as metadata without granting execution capabilities', () => {
  const pills = [...deriveLogicPills(workflow), { id: 'custom:notes', label: 'Instructions', type: 'text' as const, value: 'Synthetic data only' }]
  const result = applyLogicPills(workflow, pills)
  assert.deepEqual(JSON.parse(JSON.stringify(result.workflow)).pills, pills)
  assert.deepEqual(result.workflow.allowedTools, workflow.allowedTools)
  assert.equal(validateWorkflow(result.workflow).ok, true)
})
