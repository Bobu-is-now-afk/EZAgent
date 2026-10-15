import type {
  DocumentDraft,
  DocumentType,
  DraftPatch,
  OrderInput,
  Party,
  TaxMode,
} from './contracts'
import { DOCUMENT_TYPES } from './contracts'
import { currencyFractionDigits, isValidQuantity, parseMinorUnits } from './money'

export type ValidatedOrderInput = Omit<OrderInput, 'items'> & {
  items: Array<{ name: string | null; description: string | null; quantity: number | null; unitPriceMinor: number | null }>
}

export type ValidatedDraftPatch = Omit<DraftPatch, 'items' | 'paymentAmount'> & {
  items?: Array<{ id?: string; name: string | null; description: string | null; quantity: number | null; unitPriceMinor: number | null }>
  paymentAmountMinor?: number | null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function cleanText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return undefined
  const trimmed = value.trim()
  return trimmed || null
}

function parseParty(value: unknown): Party | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name', 'address', 'contact'])) return null
  const name = cleanText(value.name, 200)
  const address = cleanText(value.address, 500)
  const contact = cleanText(value.contact, 200)
  if (name === undefined || address === undefined || contact === undefined) return null
  return { name, address, contact }
}

export function isSupportedCurrency(value: unknown): value is 'HKD' | 'TWD' {
  return typeof value === 'string' && currencyFractionDigits(value) === 2
}

function parseDate(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? undefined : value
}

function parseOrderItems(value: unknown, currency: unknown, allowIds = false): ValidatedOrderInput['items'] | null {
  if (!Array.isArray(value) || value.length > 40) return null
  if (currency !== null && !isSupportedCurrency(currency)) return null
  const items: ValidatedOrderInput['items'] = []
  const seenIds = new Set<string>()
  for (const raw of value) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, allowIds ? ['id', 'name', 'description', 'quantity', 'unitPrice'] : ['name', 'description', 'quantity', 'unitPrice'])) return null
    if (allowIds && raw.id !== undefined && (typeof raw.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.id))) return null
    if (allowIds && typeof raw.id === 'string') {
      if (seenIds.has(raw.id)) return null
      seenIds.add(raw.id)
    }
    const name = cleanText(raw.name, 200)
    const description = cleanText(raw.description, 1000)
    const quantity = raw.quantity === null ? null : raw.quantity
    const unitPriceMinor = raw.unitPrice === null ? null : currency && typeof raw.unitPrice === 'string' ? parseMinorUnits(raw.unitPrice, currency) : undefined
    if (name === undefined || description === undefined ||
        (quantity !== null && !isValidQuantity(quantity)) ||
        (raw.unitPrice !== null && unitPriceMinor === null) || unitPriceMinor === undefined) return null
    items.push({ name, description, quantity, unitPriceMinor })
  }
  return items
}

export function parseOrderWrite(value: unknown, requireRevision: boolean): { expectedRevision: number | null; input: ValidatedOrderInput } | null {
  if (!isRecord(value)) return null
  const allowed = ['buyer', 'currency', 'items', 'agreedDate', 'termsText', 'sourceReferenceId', 'sourceReferenceVersion']
  if (requireRevision) allowed.push('expectedRevision')
  if (!hasOnlyKeys(value, allowed)) return null
  const buyer = parseParty(value.buyer)
  const currency = value.currency === null ? null : isSupportedCurrency(value.currency) ? value.currency : undefined
  const items = parseOrderItems(value.items, currency)
  const agreedDate = parseDate(value.agreedDate === undefined ? null : value.agreedDate)
  const termsText = cleanText(value.termsText === undefined ? null : value.termsText, 2000)
  const sourceReferenceId = cleanText(value.sourceReferenceId === undefined ? null : value.sourceReferenceId, 200)
  const sourceReferenceVersion = cleanText(value.sourceReferenceVersion === undefined ? null : value.sourceReferenceVersion, 200)
  const expectedRevision = value.expectedRevision
  if (!buyer || currency === undefined || !items || agreedDate === undefined || termsText === undefined ||
      sourceReferenceId === undefined || sourceReferenceVersion === undefined ||
      (requireRevision && (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1))) return null
  return {
    expectedRevision: requireRevision ? expectedRevision as number : null,
    input: { buyer, currency, items, agreedDate, termsText, sourceReferenceId, sourceReferenceVersion },
  }
}

export function parseDocumentType(value: unknown): DocumentType | null {
  return typeof value === 'string' && DOCUMENT_TYPES.includes(value as DocumentType) ? value as DocumentType : null
}

export function parseDraftCreate(value: unknown): { type: DocumentType; sourceOrder: { id: string; revision: number } | null } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['type', 'sourceOrder'])) return null
  const type = parseDocumentType(value.type)
  if (!type) return null
  if (value.sourceOrder === null) return { type, sourceOrder: null }
  if (!isRecord(value.sourceOrder) || !hasOnlyKeys(value.sourceOrder, ['id', 'revision']) ||
      typeof value.sourceOrder.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.sourceOrder.id) ||
      !Number.isSafeInteger(value.sourceOrder.revision) || (value.sourceOrder.revision as number) < 1) return null
  return { type, sourceOrder: { id: value.sourceOrder.id, revision: value.sourceOrder.revision as number } }
}

export function parseDraftPatch(value: unknown, currencyForNullPrice: string | null): { expectedRevision: number; patch: ValidatedDraftPatch } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'expectedRevision', 'buyer', 'currency', 'items', 'termsText', 'issueDate', 'dueDate', 'validUntil',
    'paymentDate', 'paymentAmount', 'paymentMethod', 'taxMode', 'taxRateBasisPoints',
  ]) || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) return null
  const patch: ValidatedDraftPatch = {}
  if ('buyer' in value) {
    const buyer = parseParty(value.buyer)
    if (!buyer) return null
    patch.buyer = buyer
  }
  const currency = 'currency' in value
    ? value.currency === null ? null : isSupportedCurrency(value.currency) ? value.currency : undefined
    : currencyForNullPrice
  if (currency === undefined) return null
  if ('currency' in value) patch.currency = currency
  if ('items' in value) {
    const parsedItems = parseOrderItems(value.items, currency, true)
    if (!parsedItems) return null
    patch.items = parsedItems.map((item, index) => {
      const inputItem = (value.items as Record<string, unknown>[])[index]
      return { ...item, ...(typeof inputItem.id === 'string' ? { id: inputItem.id } : {}) }
    })
  }
  for (const key of ['termsText', 'paymentMethod'] as const) {
    if (!(key in value)) continue
    const parsed = cleanText(value[key], key === 'termsText' ? 2000 : 100)
    if (parsed === undefined) return null
    patch[key] = parsed
  }
  for (const key of ['issueDate', 'dueDate', 'validUntil', 'paymentDate'] as const) {
    if (!(key in value)) continue
    const parsed = parseDate(value[key])
    if (parsed === undefined) return null
    patch[key] = parsed
  }
  if ('paymentAmount' in value) {
    const amount = value.paymentAmount === null ? null : currency && typeof value.paymentAmount === 'string' ? parseMinorUnits(value.paymentAmount, currency) : undefined
    if (amount === undefined || (value.paymentAmount !== null && amount === null)) return null
    patch.paymentAmountMinor = amount
  }
  if ('taxMode' in value) {
    const mode = value.taxMode
    if (mode !== null && !['none', 'included', 'excluded'].includes(String(mode))) return null
    patch.taxMode = mode as TaxMode | null
  }
  if ('taxRateBasisPoints' in value) {
    const rate = value.taxRateBasisPoints
    if (rate !== null && (!Number.isSafeInteger(rate) || (rate as number) < 0 || (rate as number) > 10_000)) return null
    patch.taxRateBasisPoints = rate as number | null
  }
  if (patch.taxMode === 'none' && patch.taxRateBasisPoints !== undefined && patch.taxRateBasisPoints !== null && patch.taxRateBasisPoints !== 0) return null
  return { expectedRevision: value.expectedRevision as number, patch }
}

export function validateDraftForReview(draft: DocumentDraft): string[] {
  const missing: string[] = []
  if (!draft.buyer.name) missing.push('buyer.name')
  if (!draft.currency || !isSupportedCurrency(draft.currency)) missing.push('currency')
  if (!draft.issueDate) missing.push('issueDate')
  if (draft.items.length === 0) missing.push('items')
  draft.items.forEach((item, index) => {
    if (!item.name && !item.description) missing.push(`items[${index}].description`)
    if (item.quantity === null || !isValidQuantity(item.quantity)) missing.push(`items[${index}].quantity`)
    if (item.unitPriceMinor === null || !Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) missing.push(`items[${index}].unitPriceMinor`)
  })
  if (draft.taxMode === null) missing.push('taxMode')
  if (draft.taxMode === 'included' || draft.taxMode === 'excluded') {
    if (draft.taxRateBasisPoints === null) missing.push('taxRateBasisPoints')
  }
  if (draft.type === 'receipt') {
    if (draft.paymentAmountMinor === null || draft.paymentAmountMinor <= 0) missing.push('paymentAmountMinor')
    if (!draft.paymentDate) missing.push('paymentDate')
  }
  return missing
}

export function reviewableFieldPaths(draft: DocumentDraft): string[] {
  const paths: string[] = []
  const addIfPresent = (path: string, value: unknown) => { if (value !== null && value !== undefined && value !== '') paths.push(path) }
  addIfPresent('buyer.name', draft.buyer.name)
  addIfPresent('buyer.address', draft.buyer.address)
  addIfPresent('buyer.contact', draft.buyer.contact)
  addIfPresent('currency', draft.currency)
  addIfPresent('termsText', draft.termsText)
  addIfPresent('issueDate', draft.issueDate)
  addIfPresent('dueDate', draft.dueDate)
  addIfPresent('validUntil', draft.validUntil)
  addIfPresent('paymentDate', draft.paymentDate)
  addIfPresent('paymentAmountMinor', draft.paymentAmountMinor)
  addIfPresent('paymentMethod', draft.paymentMethod)
  addIfPresent('taxMode', draft.taxMode)
  addIfPresent('taxRateBasisPoints', draft.taxRateBasisPoints)
  draft.items.forEach((item, index) => {
    addIfPresent(`items[${index}].name`, item.name)
    addIfPresent(`items[${index}].description`, item.description)
    addIfPresent(`items[${index}].quantity`, item.quantity)
    addIfPresent(`items[${index}].unitPriceMinor`, item.unitPriceMinor)
  })
  return paths.sort()
}
