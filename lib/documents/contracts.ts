export const DOCUMENT_TYPES = ['quotation', 'invoice', 'receipt'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export type FieldSource = 'order' | 'user' | 'ai_suggestion'

export type FieldProvenance = {
  source: FieldSource
  sourceId?: string
  sourceRevision?: number
  suggestionId?: string
  confirmed: boolean
}

export type ProvenanceMap = Record<string, FieldProvenance>

export type Party = {
  name: string | null
  address: string | null
  contact: string | null
}

export type OrderItem = {
  id: string
  name: string | null
  description: string | null
  quantity: number | null
  unitPriceMinor: number | null
}

export type OrderSnapshot = {
  id: string
  revision: number
  status: 'active' | 'archived'
  buyer: Party
  currency: string | null
  items: OrderItem[]
  agreedDate: string | null
  termsText: string | null
  source: { kind: 'manual'; referenceId: string | null; referenceVersion: string | null }
  provenance: ProvenanceMap
  createdAt: string
  updatedAt: string
}

export type OrderRecord = {
  id: string
  currentRevision: number
  revisions: OrderSnapshot[]
}

export type DraftItem = OrderItem

export type TaxMode = 'none' | 'included' | 'excluded'

export type DocumentDraft = {
  id: string
  revision: number
  type: DocumentType
  status: 'draft' | 'reviewed' | 'sample_created'
  sourceOrder: { id: string; revision: number } | null
  linkedDocumentId: string | null
  sellerProfileRef: string | null
  buyer: Party
  currency: string | null
  items: DraftItem[]
  termsText: string | null
  issueDate: string | null
  dueDate: string | null
  validUntil: string | null
  paymentDate: string | null
  paymentAmountMinor: number | null
  paymentMethod: string | null
  taxMode: TaxMode | null
  taxRateBasisPoints: number | null
  provenance: ProvenanceMap
  reviewedRevision: number | null
  reviewDigest: string | null
  reviewedAt: string | null
  sampleId: string | null
  createdAt: string
  updatedAt: string
}

export type SuggestionField = {
  path: 'termsText' | 'items[].description'
  value: string
  sourceExcerpt: string
}

export type DraftSuggestion = {
  id: string
  draftId: string
  baseRevision: number
  fields: SuggestionField[]
  missingFields: string[]
  createdAt: string
}

export type DocumentTotals = {
  subtotalMinor: number | null
  taxMinor: number | null
  totalMinor: number | null
  currency: string | null
}

export type DocumentSample = {
  id: string
  draftId: string
  draftRevision: number
  sampleNumber: string
  status: 'SAMPLE / NOT FOR PAYMENT'
  type: DocumentType
  snapshot: DocumentDraft
  totals: DocumentTotals
  digest: string
  createdAt: string
}

export type SampleIdempotency = {
  requestDigest: string
  sampleId: string
}

export type DocumentStoreState = {
  schemaVersion: 1
  orders: OrderRecord[]
  drafts: DocumentDraft[]
  suggestions: DraftSuggestion[]
  samples: DocumentSample[]
  sampleSequence: number
  sampleIdempotency: Record<string, SampleIdempotency>
}

export type OrderInput = {
  buyer: Party
  currency: string | null
  items: Array<Omit<OrderItem, 'id' | 'unitPriceMinor'> & { unitPrice: string | null }>
  agreedDate: string | null
  termsText: string | null
  sourceReferenceId: string | null
  sourceReferenceVersion: string | null
}

export type DraftPatch = {
  buyer?: Party
  currency?: string | null
  items?: Array<Omit<OrderItem, 'id' | 'unitPriceMinor'> & { id?: string; unitPrice: string | null }>
  termsText?: string | null
  issueDate?: string | null
  dueDate?: string | null
  validUntil?: string | null
  paymentDate?: string | null
  paymentAmount?: string | null
  paymentMethod?: string | null
  taxMode?: TaxMode | null
  taxRateBasisPoints?: number | null
}

export type ApiError = { error: { code: string; message: string } }
