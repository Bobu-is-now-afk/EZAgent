import type { AgentToolId, SourceReference, SourceType, ValidationResult, WorkflowDefinition } from './contracts'
import { validateWorkflowForRun } from './planner'

export type InvoiceSource = { name: string; type: SourceType; content: string }
export type InvoiceTaskOutcome = { taskId: string; tool: AgentToolId; validation: ValidationResult }
export type InvoiceExecutionResult = {
  taskOutcomes: InvoiceTaskOutcome[]
  csv: string
  sourceRefs: SourceReference[]
}

type SourceRecord = { cells: string[]; rowNumber?: number; lineNumber?: number }
type InvoiceRow = {
  sourceRef: SourceReference
  values: Record<string, string>
  issues: Set<string>
  amountMinor: number | null
  currency: string
  missingFields: string[]
}
type ParsedSource = { headers: string[]; rows: InvoiceRow[] }

const MAX_SOURCE_ROWS = 5_000
const CORE_FIELDS = ['invoice_id', 'amount', 'currency'] as const
const MAX_EVIDENCE_REFS = 20

export class InvoiceToolError extends Error {
  readonly code: string
  readonly taskId: string
  readonly validation: ValidationResult

  constructor(code: string, taskId: string, validation: ValidationResult) {
    super('Invoice workflow could not complete a deterministic tool step.')
    this.name = 'InvoiceToolError'
    this.code = code
    this.taskId = taskId
    this.validation = validation
  }
}

function passed(code: string, evidence: string[]): ValidationResult {
  return { pass: true, code, evidence, retryable: false }
}

function failed(code: string, evidence: string[]): ValidationResult {
  return { pass: false, code, evidence, retryable: false }
}

function retryableFailure(code: string, evidence: string[]): ValidationResult {
  return { pass: false, code, evidence, retryable: true }
}

function normalizedHeader(value: string): string {
  return value.trim().replace(/^\uFEFF/, '').toLowerCase()
}

function quoteCsvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function formulaSafeCell(value: string): string {
  return /^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value
}

function isFormulaSafe(value: string): boolean {
  return !/^[\s\uFEFF]*[=+\-@]/.test(value) && !/^[\t\r\n]/.test(value)
}

function parseCsvRecords(content: string): SourceRecord[] | null {
  const records: SourceRecord[] = []
  let cells: string[] = []
  let field = ''
  let inQuotes = false
  let quoteClosed = false
  let line = 1
  let recordLine = 1
  let endedAtRecordBoundary = false

  const pushRecord = () => {
    cells.push(field)
    records.push({ cells, rowNumber: recordLine })
    cells = []
    field = ''
    quoteClosed = false
    recordLine = line + 1
  }

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (inQuotes) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        inQuotes = false
        quoteClosed = true
      } else {
        field += character
        if (character === '\r') {
          line += 1
          if (content[index + 1] === '\n') {
            field += '\n'
            index += 1
          }
        } else if (character === '\n') {
          line += 1
        }
      }
      endedAtRecordBoundary = false
      continue
    }
    if (character === '"') {
      if (field.trim() !== '' || quoteClosed) return null
      field = ''
      inQuotes = true
    } else if (character === ',') {
      cells.push(field)
      field = ''
      quoteClosed = false
      endedAtRecordBoundary = false
    } else if (character === '\r' || character === '\n') {
      pushRecord()
      if (character === '\r' && content[index + 1] === '\n') index += 1
      line += 1
      recordLine = line
      endedAtRecordBoundary = true
    } else if (quoteClosed) {
      if (!/\s/.test(character)) return null
    } else {
      field += character
      endedAtRecordBoundary = false
    }
  }
  if (inQuotes) return null
  if (!endedAtRecordBoundary || cells.length > 0 || field.length > 0) pushRecord()
  return records
}

function parseTextRecords(content: string): SourceRecord[] | null {
  const lines = content.split(/\r\n|\n|\r/)
  if (lines.at(-1) === '') lines.pop()
  if (lines.length === 0 || !lines[0].trim()) return null
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes('|') ? '|' : ','
  return lines.map((line, index) => ({ cells: line.split(delimiter), lineNumber: index + 1 }))
}

function parseMinorUnits(value: string): number | null {
  const normalized = value.trim()
  if (normalized.length > 24) return null
  const match = normalized.match(/^((?:\d+)|(?:\d{1,3}(?:,\d{3})+))(?:\.(\d{1,2}))?$/)
  if (!match) return null
  try {
    const whole = BigInt(match[1].replaceAll(',', ''))
    const fraction = BigInt((match[2] ?? '').padEnd(2, '0'))
    const minor = whole * BigInt(100) + fraction
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(minor)
  } catch {
    return null
  }
}

function formatMinorUnits(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

function limitedRefs(rows: readonly InvoiceRow[], predicate: (row: InvoiceRow) => boolean): string[] {
  const refs = rows.filter(predicate).slice(0, MAX_EVIDENCE_REFS).map((row) =>
    'rowNumber' in row.sourceRef ? `row ${row.sourceRef.rowNumber}` : `line ${row.sourceRef.lineNumber}`,
  )
  return refs
}

function failure(code: string, evidence: string[], taskId = 'parse'): never {
  throw new InvoiceToolError(code, taskId, failed(code, evidence))
}

function assertWorkflow(workflow: WorkflowDefinition, source: InvoiceSource): { headers: string[]; requiredFields: string[]; columns: string[] } {
  const validated = validateWorkflowForRun(workflow, source)
  if (!validated.ok) failure('workflow_rejected', ['Workflow failed the invoice demo hard checks.'])
  const requiredStep = workflow.steps.find((step) => step.tool === 'validate_required_fields')
  const exportStep = workflow.steps.find((step) => step.tool === 'export_csv')
  const requiredFields = requiredStep?.parameters?.fields
  const columns = exportStep?.parameters?.columns
  if (!Array.isArray(requiredFields) || !requiredFields.every((field) => typeof field === 'string') ||
      !Array.isArray(columns) || !columns.every((field) => typeof field === 'string')) {
    failure('workflow_rejected', ['Workflow field configuration is invalid.'])
  }
  const records = source.type === 'csv' ? parseCsvRecords(source.content) : parseTextRecords(source.content)
  if (!records || records.length === 0) failure('source_parse_failed', ['Source rows could not be parsed safely.'])
  const headers = records[0].cells.map(normalizedHeader)
  return { headers, requiredFields, columns }
}

function makeRows(source: InvoiceSource, records: SourceRecord[], headers: string[]): { rows: InvoiceRow[]; malformedCount: number } {
  const dataRecords = records.slice(1)
  if (dataRecords.length > MAX_SOURCE_ROWS - 1) failure('row_limit_exceeded', [`Source exceeds ${MAX_SOURCE_ROWS} rows.`])
  const malformedCount = dataRecords.filter(({ cells }) => cells.length !== headers.length).length
  const rows = dataRecords.map((record): InvoiceRow => {
    const values: Record<string, string> = {}
    for (const [index, header] of headers.entries()) values[header] = record.cells[index] ?? ''
    const sourceRef: SourceReference = source.type === 'csv'
      ? { fileName: source.name, rowNumber: record.rowNumber ?? 1 }
      : { fileName: source.name, lineNumber: record.lineNumber ?? 1 }
    return {
      sourceRef,
      values,
      issues: new Set(record.cells.length === headers.length ? [] : ['malformed_row']),
      amountMinor: null,
      currency: '',
      missingFields: [],
    }
  })
  return { rows, malformedCount }
}

function executeParse(source: InvoiceSource, workflow: WorkflowDefinition): { parsed: ParsedSource; outcome: InvoiceTaskOutcome } {
  const { headers } = assertWorkflow(workflow, source)
  const records = source.type === 'csv' ? parseCsvRecords(source.content) : parseTextRecords(source.content)
  if (!records || records.length === 0) failure('source_parse_failed', ['Source rows could not be parsed safely.'])
  if (records.length > MAX_SOURCE_ROWS) failure('row_limit_exceeded', [`Source exceeds ${MAX_SOURCE_ROWS} rows.`])
  const parsedHeaders = records[0].cells.map(normalizedHeader)
  if (parsedHeaders.length !== headers.length || !CORE_FIELDS.every((field) => parsedHeaders.includes(field))) {
    failure('invalid_headers', ['Invoice source is missing a required header.'])
  }
  const { rows, malformedCount } = makeRows(source, records, parsedHeaders)
  return {
    parsed: { headers: parsedHeaders, rows },
    outcome: {
      taskId: workflow.steps[0].id,
      tool: 'parse_invoice_rows',
      validation: passed('invoice_rows_parsed', [`Parsed ${rows.length} invoice rows.`, `${malformedCount} malformed row shapes retained with source references.`]),
    },
  }
}

function executeNormalize(parsed: ParsedSource, workflow: WorkflowDefinition): { parsed: ParsedSource; outcome: InvoiceTaskOutcome } {
  const normalized = parsed.rows.map((row) => {
    const values = { ...row.values }
    for (const field of ['invoice_id', 'customer', 'description'] as const) {
      if (values[field] !== undefined) values[field] = values[field].trim()
    }
    const rawAmount = values.amount?.trim() ?? ''
    const amountMinor = rawAmount ? parseMinorUnits(rawAmount) : null
    if (rawAmount && amountMinor === null) row.issues.add('invalid_amount')
    const rawCurrency = values.currency?.trim() ?? ''
    const currency = rawCurrency.toUpperCase()
    if (rawCurrency && !/^[A-Z]{3}$/.test(currency)) row.issues.add('invalid_currency')
    if (currency) values.currency = currency
    if (amountMinor !== null) values.amount = formatMinorUnits(amountMinor)
    return { ...row, values, amountMinor, currency }
  })
  const invalidAmountCount = normalized.filter((row) => row.issues.has('invalid_amount')).length
  const invalidCurrencyCount = normalized.filter((row) => row.issues.has('invalid_currency')).length
  return {
    parsed: { ...parsed, rows: normalized },
    outcome: {
      taskId: workflow.steps[1].id,
      tool: 'normalize_invoice_fields',
      validation: passed('invoice_fields_normalized', [
        `Normalized ${normalized.length} rows using integer minor-unit amounts.`,
        `${invalidAmountCount} invalid amounts and ${invalidCurrencyCount} invalid currencies retained for validation.`,
      ]),
    },
  }
}

function missingFields(row: InvoiceRow, requiredFields: readonly string[]): string[] {
  return requiredFields.filter((field) => !row.values[field]?.trim())
}

function executeFilter(parsed: ParsedSource, workflow: WorkflowDefinition): { parsed: ParsedSource; outcome: InvoiceTaskOutcome } {
  const step = workflow.steps[2]
  const thresholdMinor = step.parameters?.thresholdMinor as number
  const currency = step.parameters?.currency as string
  const fields = workflow.steps[3].parameters?.fields as string[]
  const rows = parsed.rows.filter((row) => {
    if (/^[A-Z]{3}$/.test(row.currency) && row.currency !== currency) return false
    const missing = missingFields(row, fields)
    const malformed = row.issues.size > 0 || row.amountMinor === null || !/^[A-Z]{3}$/.test(row.currency)
    return malformed || missing.length > 0 || (row.amountMinor !== null && row.amountMinor > thresholdMinor && row.currency === currency)
  })
  return {
    parsed: { ...parsed, rows },
    outcome: {
      taskId: step.id,
      tool: 'filter_invoice_rows',
      validation: rows.length === 0
        ? parsed.rows.length === 0
          ? failed('no_invoice_rows', ['Source has no invoice data rows to process.'])
          : retryableFailure('no_matching_invoice_rows', [
              `No rows match the ${thresholdMinor} minor-unit threshold and ${currency} currency.`,
              'Provide a source currency or threshold correction; source data remains unchanged.',
            ])
        : passed('invoice_rows_filtered', [
            `Selected ${rows.length} rows above ${thresholdMinor} minor units in ${currency}, plus rows requiring validation.`,
            `Selected source references: ${limitedRefs(rows, () => true).join(', ') || 'none'}.`,
          ]),
    },
  }
}

function executeValidate(parsed: ParsedSource, workflow: WorkflowDefinition): { parsed: ParsedSource; outcome: InvoiceTaskOutcome } {
  const step = workflow.steps[3]
  const fields = step.parameters?.fields as string[]
  const rows = parsed.rows.map((row) => {
    const missing = missingFields(row, fields)
    const flagged = row.issues.size > 0 || missing.length > 0
    row.missingFields = missing
    row.values.validation_status = flagged
      ? `flagged: ${[...row.issues, ...missing.map((field) => `missing_${field}`)].join(';')}`
      : 'valid'
    return row
  })
  const flagged = rows.filter((row) => row.values.validation_status !== 'valid')
  const refEvidence = limitedRefs(flagged, () => true)
  return {
    parsed: { ...parsed, rows },
    outcome: {
      taskId: step.id,
      tool: 'validate_required_fields',
      validation: passed('invoice_required_fields_checked', [
        `Checked ${fields.length} required fields on ${rows.length} selected rows.`,
        `${flagged.length} rows flagged; source references: ${refEvidence.join(', ') || 'none'}.`,
      ]),
    },
  }
}

function exportCsv(parsed: ParsedSource, workflow: WorkflowDefinition, source: InvoiceSource): { csv: string; refs: SourceReference[]; outcome: InvoiceTaskOutcome } {
  const step = workflow.steps[4]
  const columns = step.parameters?.columns as string[]
  const rows = parsed.rows.map((row) => {
    const cells = columns.map((column) => {
      if (column === 'source_file') return source.name
      if (column === 'source_row') return String('rowNumber' in row.sourceRef ? row.sourceRef.rowNumber : row.sourceRef.lineNumber)
      if (column === 'validation_status') return row.values.validation_status ?? 'flagged: validation_missing'
      return row.values[column] ?? ''
    })
    return cells.map(formulaSafeCell)
  })
  const csv = [columns.map(formulaSafeCell), ...rows].map((cells) => cells.map(quoteCsvField).join(',')).join('\r\n') + '\r\n'
  const safe = rows.every((row) => row.every(isFormulaSafe)) && columns.map(formulaSafeCell).every(isFormulaSafe)
  if (!safe) failure('csv_formula_check_failed', ['CSV formula-safety check failed.'], step.id)
  return {
    csv,
    refs: parsed.rows.map((row) => row.sourceRef),
    outcome: {
      taskId: step.id,
      tool: 'export_csv',
      validation: passed('invoice_csv_exported', [
        `Exported ${rows.length} rows with ${columns.length} columns.`,
        'CSV formula-injection checks passed for every exported cell.',
        `Preserved ${parsed.rows.length} row source references.`,
      ]),
    },
  }
}

export function executeInvoiceWorkflow(
  workflow: WorkflowDefinition,
  source: InvoiceSource,
): InvoiceExecutionResult {
  const parse = executeParse(source, workflow)
  const normalize = executeNormalize(parse.parsed, workflow)
  const filter = executeFilter(normalize.parsed, workflow)
  const validate = executeValidate(filter.parsed, workflow)
  const exportResult = exportCsv(validate.parsed, workflow, source)
  return {
    taskOutcomes: [parse.outcome, normalize.outcome, filter.outcome, validate.outcome, exportResult.outcome],
    csv: exportResult.csv,
    sourceRefs: exportResult.refs,
  }
}

export function getSourceCurrencies(source: InvoiceSource): string[] {
  const records = source.type === 'csv' ? parseCsvRecords(source.content) : parseTextRecords(source.content)
  if (!records || records.length === 0) return []
  const headers = records[0].cells.map(normalizedHeader)
  const currencyIndex = headers.indexOf('currency')
  if (currencyIndex < 0) return []
  return [...new Set(records.slice(1)
    .map((record) => record.cells[currencyIndex]?.trim().toUpperCase() ?? '')
    .filter((currency) => /^[A-Z]{3}$/.test(currency)))].sort()
}
