export type Role = 'reviewer' | 'manager'
export type IdentityMode = 'demo' | 'trusted'
export type ReviewStatus = 'draft' | 'calculating' | 'review' | 'approved' | 'error'
export type EditorScope = 'assumptions' | 'document' | 'match' | 'exception' | 'draft'

export interface MoneyValue {
  amount: string
  currency: string
}

export interface Assumptions {
  dateFrom: string
  dateTo: string
  dateInterpretation: 'DD/MM/YYYY' | 'MM/DD/YYYY'
  currency: string
  amountToleranceCents: number
  dateWindowDays: number
  fieldMapping: Record<'date' | 'amount' | 'currency' | 'receiptNumber', string>
  confirmed: boolean
}

export interface Evidence {
  evidenceId: string
  fileName: string
  mimeType: string
  rawText: string
  page?: number
  excerpt?: string
}

export interface ExtractedFields extends MoneyValue {
  merchant: string
  receiptNumber: string
  date: string
}

export interface ReviewDocument {
  recordId: string
  evidenceId: string
  original: ExtractedFields
  corrections: Partial<ExtractedFields>
  selectedLedgerRowId?: string
  matchDisposition?: 'manual' | 'pending'
  matchReason?: string
  ambiguity?: string
  excluded?: { reason: string }
  warningAcknowledgement?: { reason: string }
  reviewNote?: { reason: string; followUp: string }
}

export interface LedgerRow extends MoneyValue {
  ledgerRowId: string
  merchant: string
  receiptNumber: string
  date: string
}

export interface Draft {
  draftId: string
  recordIds: string[]
  subject: string
  body: string
  basisRevision: number
  manuallyEdited: boolean
  stale: boolean
  suggestedSubject?: string
  suggestedBody?: string
}

export interface ReviewBatch {
  schemaVersion: '1.0'
  batchId: string
  revision: number
  mode: 'synthetic' | 'real'
  sourceVersion: string
  assumptions: Assumptions
  evidence: Evidence[]
  documents: ReviewDocument[]
  ledgerRows: LedgerRow[]
  drafts: Draft[]
}

export interface MatchResult {
  recordId: string
  status: 'matched' | 'blocked' | 'excluded'
  candidateLedgerRowIds: string[]
  selectedLedgerRowId?: string
  differenceCents?: number
  blockers: string[]
  warnings: string[]
  exclusionReason?: string
}

export interface CalculationResult {
  batchId: string
  revision: number
  requestId: string
  matches: MatchResult[]
  includedCount: number
  excludedCount: number
  totalCents: number
}

export interface ChangeEvent {
  eventId: string
  at: string
  actor: string
  identityMode: IdentityMode
  action: string
  field: string
  before: string
  after: string
  reason: string
  revision: number
}

export interface ApprovalSnapshot {
  approvalId: string
  batchId: string
  revision: number
  approvedAt: string
  approvedBy: string
  identityMode: IdentityMode
  batch: ReviewBatch
  calculation: CalculationResult
  changes: ChangeEvent[]
  invalidatedAt?: string
  invalidatedByRevision?: number
}

export interface PendingCalculation {
  batchId: string
  revision: number
  requestId: string
}

export interface ReviewState {
  batch: ReviewBatch
  status: ReviewStatus
  role: Role
  identityMode: IdentityMode
  calculation?: CalculationResult
  pendingCalculation?: PendingCalculation
  calculationError?: string
  dirtyEditors: EditorScope[]
  resultsReviewed: boolean
  draftsReviewed: boolean
  changes: ChangeEvent[]
  approvalHistory: ApprovalSnapshot[]
  currentApprovalId?: string
  notice?: string
}
