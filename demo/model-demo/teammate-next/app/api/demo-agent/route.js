/** Synthetic quote agent example. Copy to app/api/demo-agent/route.js. No real order is placed. */
import { callModel } from '../../../lib/model-client'

export const runtime = 'nodejs'
export const maxDuration = 60

// Replace with approved business data only after review. These are invented demo prices.
const CATALOG = Object.freeze({
  design: { label: 'Design session', unitPrice: 500 },
  print: { label: 'Print preparation', unitPrice: 200 },
  consult: { label: 'Consultation', unitPrice: 300 },
})
const TOOL = {
  type: 'function',
  function: {
    name: 'quote_line',
    description: 'Choose one synthetic catalogue item and quantity for a draft quotation. Never issue an invoice or place an order.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', enum: Object.keys(CATALOG) },
        quantity: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['sku', 'quantity'],
    },
  },
}

function unavailable(error) {
  return Response.json({ error: error?.status === 429 ? 'model_busy' : 'model_unavailable' }, {
    status: error?.status === 429 ? 429 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}

export async function POST(request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'invalid_origin' }, { status: 403 })
  }
  if (Number(request.headers.get('content-length')) > 4_096) {
    return Response.json({ error: 'request_too_large' }, { status: 413 })
  }
  let input
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 4_096) {
      return Response.json({ error: 'request_too_large' }, { status: 413 })
    }
    input = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof input?.request !== 'string' || !input.request.trim() || input.request.length > 1_000) {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  // Exactly one model decision and one known, read-only tool. No shell, files or real issuance.
  const messages = [
    { role: 'system', content: 'You draft synthetic quotations. Pick one catalogue item and quantity with quote_line. If vague, choose quantity 1. Prices come only from the tool.' },
    { role: 'user', content: input.request },
  ]
  let first
  try {
    first = await callModel({ messages, tools: [TOOL], tool_choice: 'required', max_tokens: 512 })
  } catch (error) {
    return unavailable(error)
  }
  const calls = first?.choices?.[0]?.message?.tool_calls
  if (!Array.isArray(calls) || calls.length !== 1 || calls[0]?.function?.name !== 'quote_line') {
    return Response.json({ error: 'draft_not_understood', message: 'I could not choose a catalogue item. Try naming design, print or consultation.' },
      { status: 422, headers: { 'cache-control': 'no-store' } })
  }
  let args
  try {
    args = typeof calls[0].function.arguments === 'string'
      ? JSON.parse(calls[0].function.arguments) : calls[0].function.arguments
  } catch {
    return Response.json({ error: 'invalid_tool_arguments' }, { status: 422 })
  }
  if (!args || !Object.hasOwn(CATALOG, args.sku) ||
      !Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 10) {
    return Response.json({ error: 'invalid_tool_arguments' }, { status: 422 })
  }
  const item = CATALOG[args.sku]
  const draft = {
    status: 'draft_only', currency: 'HKD', sku: args.sku, description: item.label,
    quantity: args.quantity, unitPrice: item.unitPrice,
    total: item.unitPrice * args.quantity,
  }
  const explanation = `Demo draft: ${draft.quantity} × ${draft.description} at HKD ${draft.unitPrice} = HKD ${draft.total}. Please review before using.`
  return Response.json({ draft, explanation, demoOnly: true }, {
    headers: { 'cache-control': 'no-store' },
  })
}
