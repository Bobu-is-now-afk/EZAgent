import { parseIsoDay, parseMoneyToCents } from './engine'
import type { Assumptions, ChangeEvent, Draft, Evidence, ExtractedFields, LedgerRow, ReviewBatch, ReviewDocument } from './types'

export interface WorkingCopy {
  batch: ReviewBatch
  changes: ChangeEvent[]
}

type JsonObject = Record<string, unknown>

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`)
  return value as JsonObject
}

function array(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${path} must contain ${min}–${max} items.`)
  return value
}

function string(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(`${path} is invalid or exceeds ${max} characters.`)
  return value
}

function integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${path} must be an integer from ${min} to ${max}.`)
  return value as number
}

function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} IDs must be unique.`)
}

function fields(value: unknown, path: string, partial = false): Partial<ExtractedFields> {
  const source = object(value, path)
  const result: Partial<ExtractedFields> = {}
  const limits = { merchant: 500, receiptNumber: 200, date: 10, amount: 64, currency: 16 } as const
  for (const key of Object.keys(limits) as Array<keyof ExtractedFields>) {
    if (partial && source[key] === undefined) continue
    result[key] = string(source[key], `${path}.${key}`, limits[key], key === 'receiptNumber' || key === 'date' || key === 'amount')
  }
  if (result.date && parseIsoDay(result.date) === undefined) throw new Error(`${path}.date must be a real ISO date or empty for review.`)
  if (result.amount && parseMoneyToCents(result.amount) === undefined) throw new Error(`${path}.amount must be a non-negative decimal with at most two places or empty for review.`)
  return result
}

function assumptions(value: unknown): Assumptions {
  const source = object(value, 'batch.assumptions')
  const mapping = object(source.fieldMapping, 'batch.assumptions.fieldMapping')
  const dateFrom = string(source.dateFrom, 'batch.assumptions.dateFrom', 10)
  const dateTo = string(source.dateTo, 'batch.assumptions.dateTo', 10)
  if (parseIsoDay(dateFrom) === undefined || parseIsoDay(dateTo) === undefined || dateFrom > dateTo) throw new Error('batch.assumptions date range is invalid.')
  if (source.dateInterpretation !== 'DD/MM/YYYY' && source.dateInterpretation !== 'MM/DD/YYYY') throw new Error('batch.assumptions.dateInterpretation is invalid.')
  if (typeof source.confirmed !== 'boolean') throw new Error('batch.assumptions.confirmed must be boolean.')
  return {
    dateFrom, dateTo,
    dateInterpretation: source.dateInterpretation,
    currency: string(source.currency, 'batch.assumptions.currency', 16),
    amountToleranceCents: integer(source.amountToleranceCents, 'batch.assumptions.amountToleranceCents', 0, 100),
    dateWindowDays: integer(source.dateWindowDays, 'batch.assumptions.dateWindowDays', 0, 7),
    fieldMapping: {
      date: string(mapping.date, 'batch.assumptions.fieldMapping.date', 100),
      amount: string(mapping.amount, 'batch.assumptions.fieldMapping.amount', 100),
      currency: string(mapping.currency, 'batch.assumptions.fieldMapping.currency', 100),
      receiptNumber: string(mapping.receiptNumber, 'batch.assumptions.fieldMapping.receiptNumber', 100),
    },
    confirmed: source.confirmed,
  }
}

function evidence(value: unknown, index: number): Evidence {
  const source = object(value, `batch.evidence[${index}]`)
  return {
    evidenceId: string(source.evidenceId, `batch.evidence[${index}].evidenceId`, 100),
    fileName: string(source.fileName, `batch.evidence[${index}].fileName`, 500),
    mimeType: string(source.mimeType, `batch.evidence[${index}].mimeType`, 100),
    rawText: string(source.rawText, `batch.evidence[${index}].rawText`, 100_000, true),
    ...(source.page === undefined ? {} : { page: integer(source.page, `batch.evidence[${index}].page`, 1, 10_000) }),
    ...(source.excerpt === undefined ? {} : { excerpt: string(source.excerpt, `batch.evidence[${index}].excerpt`, 10_000, true) }),
  }
}

function document(value: unknown, index: number): ReviewDocument {
  const source = object(value, `batch.documents[${index}]`)
  const excluded = source.excluded === undefined ? undefined : { reason: string(object(source.excluded, `batch.documents[${index}].excluded`).reason, `batch.documents[${index}].excluded.reason`, 2_000) }
  const warningAcknowledgement = source.warningAcknowledgement === undefined ? undefined : { reason: string(object(source.warningAcknowledgement, `batch.documents[${index}].warningAcknowledgement`).reason, `batch.documents[${index}].warningAcknowledgement.reason`, 2_000) }
  const reviewNoteSource = source.reviewNote === undefined ? undefined : object(source.reviewNote, `batch.documents[${index}].reviewNote`)
  const reviewNote = reviewNoteSource === undefined ? undefined : { reason: string(reviewNoteSource.reason, `batch.documents[${index}].reviewNote.reason`, 2_000, true), followUp: string(reviewNoteSource.followUp, `batch.documents[${index}].reviewNote.followUp`, 2_000, true) }
  if (source.matchDisposition !== undefined && source.matchDisposition !== 'manual' && source.matchDisposition !== 'pending') throw new Error(`batch.documents[${index}].matchDisposition is invalid.`)
  return {
    recordId: string(source.recordId, `batch.documents[${index}].recordId`, 100),
    evidenceId: string(source.evidenceId, `batch.documents[${index}].evidenceId`, 100),
    original: fields(source.original, `batch.documents[${index}].original`) as ExtractedFields,
    corrections: fields(source.corrections ?? {}, `batch.documents[${index}].corrections`, true),
    ...(source.selectedLedgerRowId === undefined ? {} : { selectedLedgerRowId: string(source.selectedLedgerRowId, `batch.documents[${index}].selectedLedgerRowId`, 100) }),
    ...(source.matchDisposition === undefined ? {} : { matchDisposition: source.matchDisposition }),
    ...(source.matchReason === undefined ? {} : { matchReason: string(source.matchReason, `batch.documents[${index}].matchReason`, 2_000) }),
    ...(source.ambiguity === undefined ? {} : { ambiguity: string(source.ambiguity, `batch.documents[${index}].ambiguity`, 2_000) }),
    ...(excluded ? { excluded } : {}),
    ...(warningAcknowledgement ? { warningAcknowledgement } : {}),
    ...(reviewNote ? { reviewNote } : {}),
  }
}

function ledgerRow(value: unknown, index: number): LedgerRow {
  const source = object(value, `batch.ledgerRows[${index}]`)
  const parsed = fields(source, `batch.ledgerRows[${index}]`) as ExtractedFields
  if (!parsed.date || !parsed.amount) throw new Error(`batch.ledgerRows[${index}] requires date and amount.`)
  return { ledgerRowId: string(source.ledgerRowId, `batch.ledgerRows[${index}].ledgerRowId`, 100), ...parsed }
}

function draft(value: unknown, index: number): Draft {
  const source = object(value, `batch.drafts[${index}]`)
  if (typeof source.manuallyEdited !== 'boolean' || typeof source.stale !== 'boolean') throw new Error(`batch.drafts[${index}] flags must be boolean.`)
  return {
    draftId: string(source.draftId, `batch.drafts[${index}].draftId`, 100),
    recordIds: array(source.recordIds, `batch.drafts[${index}].recordIds`, 100).map((id, recordIndex) => string(id, `batch.drafts[${index}].recordIds[${recordIndex}]`, 100)),
    subject: string(source.subject, `batch.drafts[${index}].subject`, 500, true),
    body: string(source.body, `batch.drafts[${index}].body`, 10_000, true),
    basisRevision: integer(source.basisRevision, `batch.drafts[${index}].basisRevision`, 1),
    manuallyEdited: source.manuallyEdited,
    stale: source.stale,
    ...(source.suggestedSubject === undefined ? {} : { suggestedSubject: string(source.suggestedSubject, `batch.drafts[${index}].suggestedSubject`, 500, true) }),
    ...(source.suggestedBody === undefined ? {} : { suggestedBody: string(source.suggestedBody, `batch.drafts[${index}].suggestedBody`, 10_000, true) }),
  }
}

function sanitizeChanges(value: unknown): ChangeEvent[] {
  return array(value ?? [], 'changes', 1_000).map((entry, index) => {
    const source = object(entry, `changes[${index}]`)
    return {
      eventId: string(source.eventId, `changes[${index}].eventId`, 100),
      at: string(source.at, `changes[${index}].at`, 100),
      actor: 'imported-untrusted',
      identityMode: 'demo',
      action: `[imported] ${string(source.action, `changes[${index}].action`, 500)}`,
      field: string(source.field, `changes[${index}].field`, 500),
      before: string(source.before, `changes[${index}].before`, 10_000, true),
      after: string(source.after, `changes[${index}].after`, 10_000, true),
      reason: string(source.reason, `changes[${index}].reason`, 2_000),
      revision: integer(source.revision, `changes[${index}].revision`, 1),
    }
  })
}

export function parseWorkingCopy(value: unknown): WorkingCopy {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string') throw new Error('Working copy must be a JSON object.')
  if (serialized.length > 2_000_000) throw new Error('Working copy exceeds the 2 MB limit.')
  const envelope = object(value, 'working copy')
  if (envelope.exportType !== 'UNAPPROVED_WORKING_COPY') throw new Error('Only an UNAPPROVED working copy can be restored.')
  const source = object(envelope.batch, 'batch')
  if (source.schemaVersion !== '1.0') throw new Error('Unsupported schemaVersion.')
  if (source.mode !== 'synthetic' && source.mode !== 'real') throw new Error('batch.mode is invalid.')
  const parsedEvidence = array(source.evidence, 'batch.evidence', 100, 1).map(evidence)
  const documents = array(source.documents, 'batch.documents', 100, 1).map(document)
  const ledgerRows = array(source.ledgerRows, 'batch.ledgerRows', 500).map(ledgerRow)
  const drafts = array(source.drafts, 'batch.drafts', 100, 1).map(draft)
  unique(parsedEvidence.map((item) => item.evidenceId), 'Evidence')
  unique(documents.map((item) => item.recordId), 'Document')
  unique(ledgerRows.map((item) => item.ledgerRowId), 'Ledger row')
  unique(drafts.map((item) => item.draftId), 'Draft')
  const evidenceIds = new Set(parsedEvidence.map((item) => item.evidenceId))
  const recordIds = new Set(documents.map((item) => item.recordId))
  const ledgerIds = new Set(ledgerRows.map((item) => item.ledgerRowId))
  if (documents.some((item) => !evidenceIds.has(item.evidenceId))) throw new Error('A document references missing evidence.')
  if (documents.some((item) => item.selectedLedgerRowId && !ledgerIds.has(item.selectedLedgerRowId))) throw new Error('A document references a missing ledger row.')
  if (drafts.some((item) => item.recordIds.some((recordId) => !recordIds.has(recordId)))) throw new Error('A draft references a missing document.')
  const batch: ReviewBatch = {
    schemaVersion: '1.0',
    batchId: string(source.batchId, 'batch.batchId', 100),
    revision: integer(source.revision, 'batch.revision', 1),
    mode: source.mode,
    sourceVersion: string(source.sourceVersion, 'batch.sourceVersion', 200),
    assumptions: assumptions(source.assumptions),
    evidence: parsedEvidence,
    documents,
    ledgerRows,
    drafts,
  }
  return { batch: structuredClone(batch), changes: sanitizeChanges(envelope.changes) }
}
