export const QUOTATION_SOURCE = 'Create a quote for two workshop days next month.'
export const SUPPORTED_CURRENCIES = ['HKD', 'USD', 'EUR', 'GBP'] as const

export type FieldSource = 'user' | 'concept-suggestion' | 'missing'

export type QuotationDraft = {
  sellerName: string
  buyerName: string
  validUntil: string
  currency: string
  description: string
  quantity: string
  unitPrice: string
  taxMode: '' | 'none' | 'rate'
  taxRate: string
  confirmed: boolean
}

export const initialDraft: QuotationDraft = {
  sellerName: '',
  buyerName: '',
  validUntil: '',
  currency: '',
  description: 'Workshop day',
  quantity: '2',
  unitPrice: '',
  taxMode: '',
  taxRate: '',
  confirmed: false,
}

export const fieldSources: Record<keyof Omit<QuotationDraft, 'confirmed'>, FieldSource> = {
  sellerName: 'missing',
  buyerName: 'missing',
  validUntil: 'missing',
  currency: 'missing',
  description: 'concept-suggestion',
  quantity: 'concept-suggestion',
  unitPrice: 'missing',
  taxMode: 'missing',
  taxRate: 'missing',
}

export function getMissingFields(draft: QuotationDraft): string[] {
  const missing: string[] = []
  if (!draft.sellerName.trim()) missing.push('Seller name')
  if (!draft.buyerName.trim()) missing.push('Buyer name')
  if (!isValidISODate(draft.validUntil)) missing.push('Valid date (YYYY-MM-DD)')
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(draft.currency)) missing.push('Currency')
  if (!draft.description.trim()) missing.push('Item description')
  const quantity = Number(draft.quantity)
  if (!draft.quantity || !Number.isSafeInteger(quantity) || quantity <= 0) missing.push('Positive whole-number quantity')
  if (toMinorUnits(draft.unitPrice) === null) missing.push('Non-negative unit price')
  if (!draft.taxMode) missing.push('Tax treatment')
  if (draft.taxMode === 'rate' && (!/^\d+(\.\d{1,2})?$/.test(draft.taxRate.trim()) || !Number.isFinite(Number(draft.taxRate)) || Number(draft.taxRate) > 100)) missing.push('Tax rate from 0 to 100% (up to 2 decimals)')
  return missing
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function toMinorUnits(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, fraction = ''] = trimmed.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

export function calculateTotals(draft: QuotationDraft) {
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(draft.currency)) return null
  if (draft.taxMode !== 'none' && draft.taxMode !== 'rate') return null
  const quantity = Number(draft.quantity)
  const unitMinor = toMinorUnits(draft.unitPrice)
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || unitMinor === null) return null
  const subtotalMinor = quantity * unitMinor
  if (!Number.isSafeInteger(subtotalMinor)) return null
  const taxRateBasisPoints = draft.taxMode === 'rate' ? Math.round(Number(draft.taxRate) * 100) : 0
  if (!Number.isSafeInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) return null
  if (draft.taxMode === 'rate' && (!/^\d+(\.\d{1,2})?$/.test(draft.taxRate.trim()) || !Number.isFinite(Number(draft.taxRate)))) return null
  const taxMinor = Number((BigInt(subtotalMinor) * BigInt(taxRateBasisPoints) + BigInt(5000)) / BigInt(10000))
  const totalMinor = subtotalMinor + taxMinor
  if (!Number.isSafeInteger(taxMinor) || !Number.isSafeInteger(totalMinor)) return null
  return { subtotalMinor, taxMinor, totalMinor }
}

export function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100)
}
