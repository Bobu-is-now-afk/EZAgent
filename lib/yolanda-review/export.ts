import { effectiveFields, parseMoneyToCents } from './engine'
import type { ApprovalSnapshot, ReviewState } from './types'

function csvText(value: string): string {
  const protectedValue = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${protectedValue.replace(/"/g, '""')}"`
}

export function buildResultsCsv(snapshot: ApprovalSnapshot): string {
  const header = ['approvalId', 'approvalRevision', 'recordId', 'status', 'originalMerchant', 'reviewedMerchant', 'originalReceiptNumber', 'reviewedReceiptNumber', 'originalDate', 'reviewedDate', 'originalAmountCents', 'reviewedAmountCents', 'originalCurrency', 'reviewedCurrency', 'ledgerRowId', 'differenceCents', 'exclusionReason']
  const rows = snapshot.calculation.matches.map((match) => {
    const document = snapshot.batch.documents.find((item) => item.recordId === match.recordId)
    if (!document) throw new Error(`Approved result references missing document ${match.recordId}.`)
    const fields = effectiveFields(document)
    const originalAmount = parseMoneyToCents(document.original.amount)
    const reviewedAmount = parseMoneyToCents(fields.amount)
    return [snapshot.approvalId, String(snapshot.revision), document.recordId, match.status, document.original.merchant, fields.merchant, document.original.receiptNumber, fields.receiptNumber, document.original.date, fields.date, originalAmount === undefined ? '' : String(originalAmount), reviewedAmount === undefined ? '' : String(reviewedAmount), document.original.currency, fields.currency, match.selectedLedgerRowId ?? '', match.differenceCents === undefined ? '' : String(match.differenceCents), match.exclusionReason ?? ''].map(csvText).join(',')
  })
  return `\uFEFF${header.map(csvText).join(',')}\r\n${rows.join('\r\n')}\r\n`
}

export function buildDraftsText(snapshot: ApprovalSnapshot): string {
  const title = `EZAgent approved drafts\nBatch: ${snapshot.batchId}\nRevision: v${snapshot.revision}\nApproval: ${snapshot.approvalId}\nApproved at: ${snapshot.approvedAt}\nNOT SENT — manual follow-up only\n`
  return `${title}\n${snapshot.batch.drafts.map((draft) => `--- ${draft.subject} ---\n${draft.body}`).join('\n\n')}`
}

export function buildReviewJson(snapshot: ApprovalSnapshot): string {
  return JSON.stringify({ exportType: 'APPROVED_REVIEW', synthetic: snapshot.batch.mode === 'synthetic', ...snapshot }, null, 2)
}

export function buildWorkingCopy(state: ReviewState): string {
  return JSON.stringify({ exportType: 'UNAPPROVED_WORKING_COPY', savedAt: new Date().toISOString(), batch: state.batch, changes: state.changes }, null, 2)
}

export function downloadText(fileName: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
