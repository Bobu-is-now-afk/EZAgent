import type { DocumentDraft, DocumentTotals } from './contracts'

const MAX_MINOR_UNITS = 1_000_000_000_000
const MAX_QUANTITY = 1_000_000
const SUPPORTED_CURRENCIES = new Set(['HKD', 'TWD'])

export function currencyFractionDigits(currency: string): number | null {
  return SUPPORTED_CURRENCIES.has(currency) ? 2 : null
}

export function parseMinorUnits(value: unknown, currency: string): number | null {
  if (typeof value !== 'string' || value.length > 24) return null
  const fractionDigits = currencyFractionDigits(currency)
  if (fractionDigits === null || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > fractionDigits) return null
  const digits = `${whole}${(fraction + '0'.repeat(fractionDigits)).slice(0, fractionDigits)}`
  const minor = Number(digits)
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR_UNITS) return null
  return minor
}

export function parseQuantity(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d{0,6}$/.test(value)) return null
  const quantity = Number(value)
  return quantity <= MAX_QUANTITY ? quantity : null
}

export function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_QUANTITY
}

function multiplyDivideRound(value: number, numerator: number, denominator: number): number {
  const quotient = Math.floor(value / denominator)
  const remainder = value % denominator
  return quotient * numerator + Math.floor((remainder * numerator + denominator / 2) / denominator)
}

export function computeDocumentTotals(draft: Pick<DocumentDraft, 'currency' | 'items' | 'taxMode' | 'taxRateBasisPoints'>): DocumentTotals {
  const currency = draft.currency
  if (!currency || currencyFractionDigits(currency) === null) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency: null }
  if (!Array.isArray(draft.items) || draft.items.length === 0) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  let subtotal = 0
  for (const item of draft.items) {
    if (item.quantity === null || item.unitPriceMinor === null) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
    if (!isValidQuantity(item.quantity) || !Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0) {
      return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
    }
    if (item.unitPriceMinor > MAX_MINOR_UNITS / item.quantity) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
    subtotal += item.unitPriceMinor * item.quantity
    if (!Number.isSafeInteger(subtotal) || subtotal > MAX_MINOR_UNITS) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  }
  if (draft.taxMode === null) {
    return { subtotalMinor: subtotal, taxMinor: null, totalMinor: null, currency }
  }
  if (!['none', 'included', 'excluded'].includes(draft.taxMode)) {
    return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  }
  if (draft.taxMode === 'none') {
    if (draft.taxRateBasisPoints !== null && draft.taxRateBasisPoints !== 0) return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
    return { subtotalMinor: subtotal, taxMinor: 0, totalMinor: subtotal, currency }
  }
  if (!Number.isSafeInteger(draft.taxRateBasisPoints) || draft.taxRateBasisPoints === null || draft.taxRateBasisPoints < 0 || draft.taxRateBasisPoints > 10_000) {
    return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  }
  const basisPoints = draft.taxRateBasisPoints
  const tax = draft.taxMode === 'included'
    ? multiplyDivideRound(subtotal, basisPoints, 10_000 + basisPoints)
    : multiplyDivideRound(subtotal, basisPoints, 10_000)
  const total = draft.taxMode === 'included' ? subtotal : subtotal + tax
  if (!Number.isSafeInteger(tax) || !Number.isSafeInteger(total) || tax > MAX_MINOR_UNITS || total > MAX_MINOR_UNITS) {
    return { subtotalMinor: null, taxMinor: null, totalMinor: null, currency }
  }
  return { subtotalMinor: subtotal, taxMinor: tax, totalMinor: total, currency }
}

export function formatMinorUnits(value: number, currency: string): string | null {
  const digits = currencyFractionDigits(currency)
  if (digits === null || !Number.isSafeInteger(value) || value < 0 || value > MAX_MINOR_UNITS) return null
  const whole = Math.floor(value / (10 ** digits))
  const fraction = digits ? `.${String(value % (10 ** digits)).padStart(digits, '0')}` : ''
  return `${whole}${fraction}`
}
