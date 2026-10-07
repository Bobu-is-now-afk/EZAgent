import { csvText } from './export'
import { parseIsoDay, parseMoneyToCents } from './engine'
import { isWorkflowConfirmed, type WorkflowConfig } from './workflow-config'

export interface TrialRunRow {
  rowId: string
  date: string
  merchant: string
  amount: string
  currency: string
  status: 'ready' | 'needs-review'
  issues: TrialRunIssue[]
}

export type TrialRunIssue = 'invalid-date' | 'missing-merchant' | 'invalid-amount' | 'missing-currency' | 'invalid-currency'

export interface TrialRunResult {
  mode: 'local-structured-preview'
  adapterId: 'receipt-json-preview-v1'
  workflowId: string
  revision: number
  processedAt: string
  rows: TrialRunRow[]
  readyCount: number
  reviewCount: number
  limitations: string[]
}

const MAX_INPUT_BYTES = 256_000
const MAX_ROWS = 100

function requiredText(value: unknown, field: string, row: number, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  if (value.length > maximum) throw new Error(`Row ${row}: ${field} exceeds ${maximum} characters.`)
  return value.trim()
}

export function canTrialRun(config: WorkflowConfig): { allowed: boolean; reason: string } {
  if (!isWorkflowConfirmed(config)) return { allowed: false, reason: 'Confirm and save the current workflow version before a trial run.' }
  if (config.templateId !== 'receipt-processing') return { allowed: false, reason: 'This local preview only supports the receipt-processing template.' }
  return { allowed: true, reason: '' }
}

export function runReceiptJsonPreview(config: WorkflowConfig, raw: string, processedAt = new Date().toISOString()): TrialRunResult {
  const capability = canTrialRun(config)
  if (!capability.allowed) throw new Error(capability.reason)
  if (new TextEncoder().encode(raw).byteLength > MAX_INPUT_BYTES) throw new Error('Trial input exceeds 256 KB.')

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('Trial input must be valid JSON.') }
  if (!Array.isArray(parsed)) throw new Error('Trial input must be a JSON array.')
  if (!parsed.length) throw new Error('Trial input must contain at least one row.')
  if (parsed.length > MAX_ROWS) throw new Error('Trial input exceeds 100 rows.')

  const rowIds = new Set<string>()
  const rows = parsed.map((value, index): TrialRunRow => {
    const rowNumber = index + 1
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Row ${rowNumber}: expected an object.`)
    const candidate = value as Record<string, unknown>
    if (candidate.id !== undefined && typeof candidate.id !== 'string') throw new Error(`Row ${rowNumber}: id must be text.`)
    const rowId = requiredText(candidate.id, 'id', rowNumber, 100) || `row-${rowNumber}`
    if (rowIds.has(rowId)) throw new Error(`Row ${rowNumber}: duplicate id ${rowId}.`)
    rowIds.add(rowId)

    const date = requiredText(candidate.date, 'date', rowNumber, 40)
    const merchant = requiredText(candidate.merchant, 'merchant', rowNumber, 200)
    const amount = typeof candidate.amount === 'number' && Number.isFinite(candidate.amount)
      ? String(candidate.amount)
      : requiredText(candidate.amount, 'amount', rowNumber, 40)
    const currency = typeof candidate.currency === 'string'
        ? requiredText(candidate.currency, 'currency', rowNumber, 10).toUpperCase()
        : ''
    const issues: TrialRunIssue[] = []
    if (parseIsoDay(date) === undefined) issues.push('invalid-date')
    if (!merchant) issues.push('missing-merchant')
    if (parseMoneyToCents(amount) === undefined) issues.push('invalid-amount')
    if (!currency) issues.push('missing-currency')
    else if (!/^[A-Z]{3}$/.test(currency)) issues.push('invalid-currency')

    return { rowId, date, merchant, amount, currency, status: issues.length ? 'needs-review' : 'ready', issues }
  })

  const readyCount = rows.filter((row) => row.status === 'ready').length
  return {
    mode: 'local-structured-preview',
    adapterId: 'receipt-json-preview-v1',
    workflowId: config.workflowId,
    revision: config.revision,
    processedAt,
    rows,
    readyCount,
    reviewCount: rows.length - readyCount,
    limitations: [
      'Uses user-provided structured JSON only; it does not read receipt images or PDFs.',
      'Checks the fixed receipt preview contract; it does not execute arbitrary natural-language rules.',
      'Does not send messages, overwrite source files, or persist run results.',
    ],
  }
}

export function buildTrialRunCsv(result: TrialRunResult): string {
  const header = ['workflowId', 'revision', 'rowId', 'date', 'merchant', 'amount', 'currency', 'status', 'issues']
  const rows = result.rows.map((row) => [result.workflowId, String(result.revision), row.rowId, row.date, row.merchant, row.amount, row.currency, row.status, row.issues.join(' | ')].map(csvText).join(','))
  return `\uFEFF${header.map(csvText).join(',')}\r\n${rows.join('\r\n')}\r\n`
}
