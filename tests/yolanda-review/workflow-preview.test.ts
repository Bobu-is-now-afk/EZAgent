import test from 'node:test'
import assert from 'node:assert/strict'
import { organizeRequirement, updateWorkflowPreviewParameter } from '../../lib/yolanda-review/workflow-config'
import { canApplyWorkflowPreview, runWorkflowPreview, WORKFLOW_PREVIEW_CASE_VERSION } from '../../lib/yolanda-review/workflow-preview'

test('changing date interpretation changes the same built-in case', () => {
  const dd = organizeRequirement('Organize receipts.', 'preview-workflow', 'en')
  const mm = updateWorkflowPreviewParameter(dd, 'dateInterpretation', 'MM/DD/YYYY')
  const before = runWorkflowPreview(dd, 'request-1')
  const after = runWorkflowPreview(mm, 'request-2')
  assert.equal(before.results.find((value) => value.caseId === 'ambiguous-date')?.outcome, '2026-10-09')
  assert.equal(after.results.find((value) => value.caseId === 'ambiguous-date')?.outcome, '2026-09-10')
})

test('accepted currencies change the foreign-currency case without conversion', () => {
  const base = organizeRequirement('Organize receipts.', 'preview-workflow', 'en')
  const hkdOnly = runWorkflowPreview(base, 'request-1')
  const acceptsUsd = runWorkflowPreview(updateWorkflowPreviewParameter(base, 'acceptedCurrencies', ['HKD', 'USD']), 'request-2')
  assert.equal(hkdOnly.results.find((value) => value.caseId === 'foreign-currency')?.status, 'needs-review')
  assert.equal(acceptsUsd.results.find((value) => value.caseId === 'foreign-currency')?.status, 'included')
})

test('preview results are bound to workflow, revision, request, and case version', () => {
  const config = organizeRequirement('Organize receipts.', 'preview-workflow', 'en')
  const result = runWorkflowPreview(config, 'request-1')
  assert.equal(result.caseVersion, WORKFLOW_PREVIEW_CASE_VERSION)
  assert.equal(canApplyWorkflowPreview(result, config.workflowId, config.revision, 'request-1'), true)
  const changed = updateWorkflowPreviewParameter(config, 'dateInterpretation', 'MM/DD/YYYY')
  assert.equal(canApplyWorkflowPreview(result, changed.workflowId, changed.revision, 'request-1'), false)
  assert.equal(canApplyWorkflowPreview(result, config.workflowId, config.revision, 'request-2'), false)
})
