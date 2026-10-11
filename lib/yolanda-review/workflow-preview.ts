import type { WorkflowConfig, WorkflowPreviewParameterKey } from './workflow-config'

export const WORKFLOW_PREVIEW_CASE_VERSION = 'workflow-preview-v2' as const

export interface WorkflowPreviewCaseResult {
  caseId: 'ambiguous-date' | 'foreign-currency' | 'missing-merchant' | 'invoice-threshold'
  parameter: WorkflowPreviewParameterKey
  input: string
  outcome: string
  reason: string
  status: 'included' | 'excluded' | 'needs-review' | 'included-with-warning'
}

export interface WorkflowPreviewResult {
  workflowId: string
  revision: number
  requestId: string
  caseVersion: typeof WORKFLOW_PREVIEW_CASE_VERSION
  results: WorkflowPreviewCaseResult[]
}

export function runWorkflowPreview(config: WorkflowConfig, requestId: string): WorkflowPreviewResult {
  if (!['receipt-processing', 'invoice-filter-export'].includes(config.templateId ?? '') || !config.previewParameters) throw new Error('This workflow has no supported rule preview.')
  const parameters = config.previewParameters
  const dateOutcome = parameters.dateInterpretation?.value === 'MM/DD/YYYY' ? '2026-09-10' : '2026-10-09'
  const acceptsUsd = parameters.acceptedCurrencies.value.includes('USD')
  const keepsMissingMerchant = parameters.missingMerchantHandling.value === 'keep-empty-marked'
  const threshold = parameters.invoiceThresholdMinor?.value
  const results: WorkflowPreviewCaseResult[] = []
  if (parameters.dateInterpretation) results.push({ caseId: 'ambiguous-date', parameter: 'dateInterpretation', input: '09/10/2026', outcome: dateOutcome, reason: `Date format: ${parameters.dateInterpretation.value}`, status: 'included' })
  results.push(
    { caseId: 'foreign-currency', parameter: 'acceptedCurrencies', input: 'USD 20.00', outcome: acceptsUsd ? 'Included as USD 20.00' : 'Marked for review; no currency conversion', reason: `Accepted currencies: ${parameters.acceptedCurrencies.value.join(', ')}`, status: acceptsUsd ? 'included' : 'needs-review' },
    { caseId: 'missing-merchant', parameter: 'missingMerchantHandling', input: 'Merchant: (missing)', outcome: keepsMissingMerchant ? 'Included with empty merchant and warning' : 'Marked for human review', reason: keepsMissingMerchant ? 'Missing merchant: keep empty and mark' : 'Missing merchant: needs review', status: keepsMissingMerchant ? 'included-with-warning' : 'needs-review' },
  )
  if (threshold !== undefined) {
    const included = 1_250_000 > threshold
    results.push({ caseId: 'invoice-threshold', parameter: 'invoiceThresholdMinor', input: 'HKD 12,500.00', outcome: included ? 'Included' : 'Filtered out', reason: `Strictly above ${threshold} minor units`, status: included ? 'included' : 'excluded' })
  }
  return {
    workflowId: config.workflowId,
    revision: config.revision,
    requestId,
    caseVersion: WORKFLOW_PREVIEW_CASE_VERSION,
    results,
  }
}

export function canApplyWorkflowPreview(result: WorkflowPreviewResult, workflowId: string, revision: number, requestId: string, caseVersion = WORKFLOW_PREVIEW_CASE_VERSION) {
  return result.workflowId === workflowId && result.revision === revision && result.requestId === requestId && result.caseVersion === caseVersion
}
