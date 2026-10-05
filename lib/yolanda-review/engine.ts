import type { CalculationResult, ExtractedFields, ReviewBatch, ReviewDocument } from './types'

export const MAX_TOLERANCE_CENTS = 100
export const MAX_DATE_WINDOW_DAYS = 7

export function parseMoneyToCents(value: string): number | undefined {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return undefined
  const [whole, fraction = ''] = value.trim().split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : undefined
}

export function effectiveFields(document: ReviewDocument): ExtractedFields {
  return { ...document.original, ...document.corrections }
}

export function normalizeReceipt(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function parseIsoDay(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return date.getTime() / 86_400_000
}

export function validateAssumptions(batch: ReviewBatch): string[] {
  const { assumptions } = batch
  const errors: string[] = []
  if (parseIsoDay(assumptions.dateFrom) === undefined || parseIsoDay(assumptions.dateTo) === undefined || assumptions.dateFrom > assumptions.dateTo) errors.push('Date range is invalid.')
  if (!Number.isInteger(assumptions.amountToleranceCents) || assumptions.amountToleranceCents < 0 || assumptions.amountToleranceCents > MAX_TOLERANCE_CENTS) errors.push('Amount tolerance must be 0–100 cents.')
  if (!Number.isInteger(assumptions.dateWindowDays) || assumptions.dateWindowDays < 0 || assumptions.dateWindowDays > MAX_DATE_WINDOW_DAYS) errors.push('Date window must be 0–7 days.')
  if (!assumptions.currency.trim()) errors.push('Currency is required.')
  if (new Set(Object.values(assumptions.fieldMapping)).size !== Object.values(assumptions.fieldMapping).length) errors.push('Each field mapping must use a different source column.')
  if (batch.mode === 'synthetic') {
    const supported = { date: 'transaction_date', amount: 'gross_amount', currency: 'currency', receiptNumber: 'receipt_no' }
    if (assumptions.dateInterpretation !== 'DD/MM/YYYY') errors.push('Synthetic adapter cannot recalculate another date interpretation.')
    if (Object.entries(supported).some(([field, column]) => assumptions.fieldMapping[field as keyof typeof supported] !== column)) errors.push('Synthetic adapter cannot recalculate this field mapping.')
  }
  return errors
}

export function calculateBatch(batch: ReviewBatch, requestId: string): CalculationResult {
  const occupied = new Map<string, string>()
  const active = batch.documents.filter((document) => !document.excluded)
  const duplicateKeys = new Map<string, number>()
  for (const document of active) {
    const fields = effectiveFields(document)
    const key = `${normalizeReceipt(fields.receiptNumber)}|${fields.amount}|${fields.currency}`
    if (normalizeReceipt(fields.receiptNumber)) duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1)
  }

  const matches = batch.documents.map((document) => {
    if (document.excluded) return { recordId: document.recordId, status: 'excluded' as const, candidateLedgerRowIds: [], blockers: [], warnings: [], exclusionReason: document.excluded.reason }

    const fields = effectiveFields(document)
    const amountCents = parseMoneyToCents(fields.amount)
    const documentDay = parseIsoDay(fields.date)
    const blockers: string[] = []
    const warnings: string[] = []
    if (amountCents === undefined) blockers.push('Amount is invalid.')
    if (documentDay === undefined) blockers.push('Date is missing or invalid.')
    if (documentDay !== undefined) {
      const from = parseIsoDay(batch.assumptions.dateFrom)
      const to = parseIsoDay(batch.assumptions.dateTo)
      if (from !== undefined && to !== undefined && (documentDay < from || documentDay > to)) blockers.push('Date is outside the confirmed task range.')
    }
    if (fields.currency !== batch.assumptions.currency) blockers.push(`Currency ${fields.currency || '(missing)'} is unsupported; expected ${batch.assumptions.currency}.`)
    const duplicateKey = `${normalizeReceipt(fields.receiptNumber)}|${fields.amount}|${fields.currency}`
    if ((duplicateKeys.get(duplicateKey) ?? 0) > 1) blockers.push('Possible duplicate receipt requires correction or exclusion.')

    const candidates = amountCents === undefined || documentDay === undefined ? [] : batch.ledgerRows.filter((row) => {
      const rowAmount = parseMoneyToCents(row.amount)
      const rowDay = parseIsoDay(row.date)
      return row.currency === fields.currency && rowAmount !== undefined && rowDay !== undefined
        && Math.abs(rowAmount - amountCents) <= batch.assumptions.amountToleranceCents
        && Math.abs(rowDay - documentDay) <= batch.assumptions.dateWindowDays
        && (!fields.receiptNumber || normalizeReceipt(row.receiptNumber) === normalizeReceipt(fields.receiptNumber))
    })
    const candidateIds = candidates.map((row) => row.ledgerRowId)

    let selected = document.selectedLedgerRowId
    if (!selected && document.matchDisposition !== 'pending' && fields.receiptNumber && candidates.length === 1) selected = candidates[0].ledgerRowId
    if (selected && !candidateIds.includes(selected)) {
      blockers.push('Selected ledger row no longer meets currency, amount, date, and receipt constraints.')
      selected = undefined
    }
    if (!selected) {
      if (document.matchDisposition === 'pending') blockers.push('Match is marked pending review.')
      else if (!fields.receiptNumber && candidates.length) blockers.push('Missing receipt number requires a manual match and reason.')
      else if (candidates.length === 0) blockers.push('No eligible ledger match.')
      else if (candidates.length > 1) blockers.push('Multiple eligible matches require a manual selection.')
    }
    if (selected && !fields.receiptNumber && !document.matchReason?.trim()) blockers.push('Manual match reason is required when receipt number is missing.')
    if (selected) {
      const owner = occupied.get(selected)
      if (owner) {
        blockers.push(`Ledger row already used by ${owner}.`)
        selected = undefined
      } else if (!blockers.length) occupied.set(selected, document.recordId)
    }
    const evidenceText = batch.evidence.find((item) => item.evidenceId === document.evidenceId)?.rawText ?? ''
    if (/<script\b|ignore\s+(?:all\s+)?(?:limits|instructions)|send\s+all\s+records/i.test(evidenceText)) warnings.push('Evidence contains instruction-like text; rendered as plain text and ignored.')
    const selectedRow = batch.ledgerRows.find((row) => row.ledgerRowId === selected)
    const differenceCents = selectedRow && amountCents !== undefined ? amountCents - (parseMoneyToCents(selectedRow.amount) ?? amountCents) : undefined
    return { recordId: document.recordId, status: blockers.length ? 'blocked' as const : 'matched' as const, candidateLedgerRowIds: candidateIds, selectedLedgerRowId: selected, differenceCents, blockers, warnings }
  })

  const included = matches.filter((match) => match.status === 'matched')
  const totalCents = included.reduce((sum, match) => {
    const document = batch.documents.find((item) => item.recordId === match.recordId)
    return sum + (document ? parseMoneyToCents(effectiveFields(document).amount) ?? 0 : 0)
  }, 0)
  return { batchId: batch.batchId, revision: batch.revision, requestId, matches, includedCount: included.length, excludedCount: matches.filter((match) => match.status === 'excluded').length, totalCents }
}
