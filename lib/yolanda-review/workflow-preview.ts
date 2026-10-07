import type { WorkflowConfig, WorkflowPreviewParameterKey } from './workflow-config'

export const WORKFLOW_PREVIEW_CASE_VERSION = 'receipt-preview-v1' as const

export interface WorkflowPreviewCaseResult {
  caseId: 'ambiguous-date' | 'foreign-currency' | 'missing-merchant'
  parameter: WorkflowPreviewParameterKey
  input: string
  outcome: string
  reason: string
  status: 'included' | 'needs-review' | 'included-with-warning'
}

export interface WorkflowPreviewResult {
  workflowId: string
  revision: number
  requestId: string
  caseVersion: typeof WORKFLOW_PREVIEW_CASE_VERSION
  results: WorkflowPreviewCaseResult[]
}

export function runWorkflowPreview(config: WorkflowConfig, requestId: string): WorkflowPreviewResult {
  if (config.templateId !== 'receipt-processing' || !config.previewParameters) throw new Error('This workflow has no supported rule preview.')
  const parameters = config.previewParameters
  const dateOutcome = parameters.dateInterpretation.value === 'DD/MM/YYYY' ? '2026-10-09' : '2026-09-10'
  const acceptsUsd = parameters.acceptedCurrencies.value.includes('USD')
  const keepsMissingMerchant = parameters.missingMerchantHandling.value === 'keep-empty-marked'
  return {
    workflowId: config.workflowId,
    revision: config.revision,
    requestId,
    caseVersion: WORKFLOW_PREVIEW_CASE_VERSION,
    results: [
      { caseId: 'ambiguous-date', parameter: 'dateInterpretation', input: '09/10/2026', outcome: dateOutcome, reason: `Date format: ${parameters.dateInterpretation.value}`, status: 'included' },
      { caseId: 'foreign-currency', parameter: 'acceptedCurrencies', input: 'USD 20.00', outcome: acceptsUsd ? 'Included as USD 20.00' : 'Marked for review; no currency conversion', reason: `Accepted currencies: ${parameters.acceptedCurrencies.value.join(', ')}`, status: acceptsUsd ? 'included' : 'needs-review' },
      { caseId: 'missing-merchant', parameter: 'missingMerchantHandling', input: 'Merchant: (missing)', outcome: keepsMissingMerchant ? 'Included with empty merchant and warning' : 'Marked for human review', reason: keepsMissingMerchant ? 'Missing merchant: keep empty and mark' : 'Missing merchant: needs review', status: keepsMissingMerchant ? 'included-with-warning' : 'needs-review' },
    ],
  }
}

export function canApplyWorkflowPreview(result: WorkflowPreviewResult, workflowId: string, revision: number, requestId: string, caseVersion = WORKFLOW_PREVIEW_CASE_VERSION) {
  return result.workflowId === workflowId && result.revision === revision && result.requestId === requestId && result.caseVersion === caseVersion
}
