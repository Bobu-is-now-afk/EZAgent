export type DocumentType = 'quotation' | 'invoice' | 'receipt'
export type FieldSource = 'order' | 'user' | 'ai_suggestion'
export type FieldProvenance = { source: FieldSource; sourceId?: string; sourceRevision?: number; suggestionId?: string; confirmed: boolean }
export type ProvenanceMap = Record<string, FieldProvenance>
export type Party = { name: string | null; address: string | null; contact: string | null }
export type OrderItem = { id: string; name: string | null; description: string | null; quantity: number | null; unitPriceMinor: number | null }
export type Order = {
  id: string; revision: number; status: 'active' | 'archived'; buyer: Party; currency: string | null; items: OrderItem[];
  agreedDate: string | null; termsText: string | null; source: { kind: 'manual'; referenceId: string | null; referenceVersion: string | null };
  provenance: ProvenanceMap; createdAt: string; updatedAt: string
}
export type Draft = {
  id: string; revision: number; type: DocumentType; status: 'draft' | 'reviewed' | 'sample_created';
  sourceOrder: { id: string; revision: number } | null; linkedDocumentId: string | null; sellerProfileRef: string | null;
  buyer: Party; currency: string | null; items: OrderItem[]; termsText: string | null;
  issueDate: string | null; dueDate: string | null; validUntil: string | null; paymentDate: string | null;
  paymentAmountMinor: number | null; paymentMethod: string | null; taxMode: 'none' | 'included' | 'excluded' | null;
  taxRateBasisPoints: number | null; provenance: ProvenanceMap; reviewedRevision: number | null;
  reviewDigest: string | null; reviewedAt: string | null; sampleId: string | null; createdAt: string; updatedAt: string;
  sourceOrderCurrentRevision?: number | null; sampleNumber?: string;
  totals?: Totals
}
export type SuggestionField = { path: 'termsText' | 'items[].description'; value: string; sourceExcerpt: string }
export type DraftSuggestion = { id: string; draftId: string; baseRevision: number; fields: SuggestionField[]; missingFields: string[]; createdAt: string }
export type Totals = { subtotalMinor: number | null; taxMinor: number | null; totalMinor: number | null; currency: string | null }
export type SampleDocument = {
  id: string; draftId: string; draftRevision: number; sampleNumber: string; status: 'SAMPLE / NOT FOR PAYMENT'; type: DocumentType;
  snapshot: Draft; totals: Totals; digest: string; createdAt: string
}
export type ApiError = { code: string; message: string }

export class ApiRequestError extends Error {
  code?: string
  constructor(message: string, code?: string) { super(message); this.name = 'ApiRequestError'; this.code = code }
}

export async function documentsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as { data?: T; error?: ApiError } | null
  if (!response.ok) throw new ApiRequestError(body?.error?.message ?? `文件工作台回應失敗（${response.status}）。`, body?.error?.code)
  if (!body || !('data' in body)) throw new Error('文件工作台回應格式不正確。')
  return body.data as T
}

export function currencyScale(currency: string | null | undefined): number {
  return currency === 'HKD' || currency === 'TWD' ? 2 : -1
}

export function moneyFromInput(value: string, currency?: string | null): number | null {
  const text = value.trim()
  if (!text) return null
  if (currencyScale(currency) < 0) throw new Error('請先選擇 HKD 或 TWD。')
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('請輸入非負金額，最多兩位小數，不含千位分隔符。')
  const [whole, fraction = ''] = text.split('.')
  const minor = BigInt(whole) * BigInt(100) + BigInt((fraction + '00').slice(0, 2))
  if (minor > BigInt(1_000_000_000_000)) throw new Error('金額不可超過 1,000,000,000,000 個最小單位。')
  return Number(minor)
}

export function moneyInput(value: number | null | undefined): string {
  if (value == null || !Number.isSafeInteger(value) || value < 0) return ''
  const whole = Math.floor(value / 100)
  const fraction = String(value % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}

export function decimalFromMinor(value: number | null | undefined): string | null {
  return value == null ? null : moneyInput(value)
}

export function basisPointsFromInput(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  if (!/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(text)) throw new Error('稅率請輸入 0 至 100 之間的數字，最多兩位小數。')
  const [whole, fraction = ''] = text.split('.')
  return Number(BigInt(whole) * BigInt(100) + BigInt((fraction + '00').slice(0, 2)))
}

export function formatMoney(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !currency || currencyScale(currency) < 0) return '待填寫'
  try { return new Intl.NumberFormat('zh-Hant', { style: 'currency', currency }).format(minor / 100) }
  catch { return `${currency} ${moneyInput(minor)}` }
}

export function lineTotal(item: Pick<OrderItem, 'quantity' | 'unitPriceMinor'>): number | null {
  if (item.quantity == null || item.unitPriceMinor == null || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 1_000_000 || !Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0 || item.unitPriceMinor > 1_000_000_000_000) return null
  const value = BigInt(item.quantity) * BigInt(item.unitPriceMinor)
  return value <= BigInt(1_000_000_000_000) ? Number(value) : null
}

export function computeTotals(draft: Pick<Draft, 'currency' | 'items' | 'taxMode' | 'taxRateBasisPoints'>): Totals {
  const currency = draft.currency
  if (!currency || currencyScale(currency) < 0) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency: null }
  if (draft.items.length === 0 || draft.items.some((item) => item.quantity == null || item.unitPriceMinor == null)) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  const lines = draft.items.map(lineTotal)
  if (lines.some((value) => value == null)) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  const subtotal = lines.reduce<bigint>((sum, value) => sum + BigInt(value ?? 0), BigInt(0))
  if (subtotal > BigInt(1_000_000_000_000)) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  if (draft.taxMode == null) return { subtotalMinor: Number(subtotal), taxMinor: null, totalMinor: null, currency }
  if (draft.taxMode === 'none') return { subtotalMinor: Number(subtotal), taxMinor: 0, totalMinor: Number(subtotal), currency }
  const rate = draft.taxRateBasisPoints
  if (rate == null || !Number.isSafeInteger(rate) || rate < 0 || rate > 10_000) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  const points = BigInt(rate)
  const tax = draft.taxMode === 'included' ? (subtotal * points + (BigInt(10_000) + points) / BigInt(2)) / (BigInt(10_000) + points) : (subtotal * points + BigInt(5_000)) / BigInt(10_000)
  const total = draft.taxMode === 'included' ? subtotal : subtotal + tax
  if (tax > BigInt(1_000_000_000_000) || total > BigInt(1_000_000_000_000)) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  return { subtotalMinor: Number(subtotal), taxMinor: Number(tax), totalMinor: Number(total), currency }
}
