export const GEMINI_MODEL = 'gemini-2.5-flash'
export const LIMITS = Object.freeze({ bodyBytes: 4096, fixtureChars: 1200, outputTokens: 512, timeoutMs: 30_000 })

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const CHAT_FIXTURES = Object.freeze({
  study_schedule: 'Create a concise 3-day study schedule for a synthetic exam-preparation example. Include short breaks.',
  cache_comparison: 'Compare two ways to cache API responses for a synthetic software design example. Keep the trade-offs concise.',
  launch_checklist: 'Draft a short launch checklist for a synthetic small-app example. Keep it practical and concise.',
})
const DOCUMENT_FIXTURE = 'Create a quote for two workshop days next month.'
const AGENT_FIXTURE = 'Plan a synthetic document workflow for a small workshop quote. Propose roles, steps, and missing information for human review.'

export class DemoError extends Error {
  constructor(code, status) { super(code); this.name = 'DemoError'; this.code = code; this.status = status }
}

const roles = Object.freeze([
  { id: 'gm', label: 'GM', responsibility: 'Proposes task division and review criteria; cannot approve or deploy.' },
  { id: 'research_manager', label: 'Research manager', responsibility: 'Identifies facts to verify and missing inputs.' },
  { id: 'delivery_manager', label: 'Delivery manager', responsibility: 'Suggests sequence, dependencies, and human checks.' },
  { id: 'analysis_worker', label: 'Analysis worker', responsibility: 'Drafts an analysis approach using synthetic inputs.' },
  { id: 'document_worker', label: 'Document worker', responsibility: 'Drafts document fields without assigning amount, tax, payment, or approval.' },
])

const objectSchema = (properties, required) => ({ type: 'OBJECT', properties, required })
const textArray = (maxItems = 4) => ({ type: 'ARRAY', maxItems, items: { type: 'STRING' } })

export function parseRequest(value, allowedKeys, allowedFixtures) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DemoError('invalid_input', 400)
  const keys = Object.keys(value)
  if (keys.some((key) => !allowedKeys.includes(key)) || !allowedKeys.every((key) => key === 'template' || keys.includes(key))) throw new DemoError('invalid_input', 400)
  if (!allowedFixtures.includes(value.fixtureId)) throw new DemoError('invalid_input', 400)
  if ('template' in value && !['documents', 'review', 'other'].includes(value.template)) throw new DemoError('invalid_input', 400)
  return value
}

function parseJsonText(text) {
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
  } catch { /* sanitized below */ }
  throw new DemoError('invalid_provider_response', 502)
}

function boundedStrings(value, maxItems, maxChars) {
  if (!Array.isArray(value)) throw new DemoError('invalid_provider_response', 502)
  return value.slice(0, maxItems).map((item) => {
    if (typeof item !== 'string') throw new DemoError('invalid_provider_response', 502)
    return item.slice(0, maxChars)
  })
}

function makePrompt(kind, fixture, template) {
  if (kind === 'chat') return [
    'Answer the following synthetic demo prompt concisely. This endpoint is text-only: do not claim to execute tools, process real documents, or change external systems.', fixture,
  ].join('\n\n')
  if (kind === 'agent') return [
    'Suggest a draft plan for this synthetic task. Use the fixed role set supplied by the server. Return only short proposedSteps (max 4) and missing (max 4). Do not claim execution, approval, deployment, or completed work.',
    `Template: ${template}. Synthetic task: ${fixture}`,
  ].join('\n')
  return [
    'From the explicit facts in this synthetic quote, return only buyer, description, quantity, and missing fields. Never return or infer price, amount, tax, currency, bank details, payment, exact inferred dates, or approval. If a fact is not explicit, use null for the value and include its field in missing.',
    `Synthetic source: ${fixture}`,
  ].join('\n')
}

async function callGemini(prompt, responseSchema, options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY
  if (!apiKey) throw new DemoError('not_configured', 503)
  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LIMITS.timeoutMs)
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: {
        temperature: 0.2, maxOutputTokens: LIMITS.outputTokens, responseMimeType: 'application/json', responseSchema,
      } }),
      cache: 'no-store', signal: controller.signal,
    })
    if (response.status === 429) throw new DemoError('provider_unavailable', 502)
    if (!response.ok) throw new DemoError('provider_unavailable', 502)
    const envelope = await response.json()
    const text = envelope?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? '').join('').trim()
    if (!text || text.length > 5_000) throw new DemoError('invalid_provider_response', 502)
    return parseJsonText(text)
  } catch (error) {
    if (error instanceof DemoError) throw error
    if (error?.name === 'AbortError') throw new DemoError('provider_timeout', 504)
    if (error instanceof SyntaxError) throw new DemoError('invalid_provider_response', 502)
    throw new DemoError('provider_unavailable', 502)
  } finally { clearTimeout(timer) }
}

export async function chat(value, options = {}) {
  const request = parseRequest(value, ['fixtureId'], Object.keys(CHAT_FIXTURES))
  const fixture = CHAT_FIXTURES[request.fixtureId]
  if (fixture.length > LIMITS.fixtureChars) throw new DemoError('invalid_input', 400)
  const result = await callGemini(makePrompt('chat', fixture), objectSchema({ answer: { type: 'STRING' } }, ['answer']), options)
  if (Object.keys(result).some((key) => key !== 'answer')) throw new DemoError('invalid_provider_response', 502)
  if (typeof result.answer !== 'string' || result.answer.length > 2_000) throw new DemoError('invalid_provider_response', 502)
  return { status: 'live', source: 'gemini', model: GEMINI_MODEL, answer: result.answer }
}

export async function agentSuggest(value, options = {}) {
  const request = parseRequest(value, ['fixtureId', 'template'], ['synthetic_document_task'])
  const template = request.template ?? 'documents'
  const fixture = AGENT_FIXTURE
  if (fixture.length > LIMITS.fixtureChars) throw new DemoError('invalid_input', 400)
  const result = await callGemini(makePrompt('agent', fixture, template), objectSchema({ proposedSteps: textArray(4), missing: textArray(4) }, ['proposedSteps', 'missing']), options)
  if (Object.keys(result).some((key) => !['proposedSteps', 'missing'].includes(key))) throw new DemoError('invalid_provider_response', 502)
  const proposedSteps = boundedStrings(result.proposedSteps, 4, 180)
  const missing = boundedStrings(result.missing, 4, 160)
  return { status: 'live', source: 'gemini', model: GEMINI_MODEL, roles, proposedSteps, missing }
}

export async function documentSuggest(value, options = {}) {
  const request = parseRequest(value, ['fixtureId'], ['workshop_quote'])
  const fixture = DOCUMENT_FIXTURE
  if (fixture.length > LIMITS.fixtureChars) throw new DemoError('invalid_input', 400)
  const resultSchema = objectSchema({
    buyer: { type: 'STRING', nullable: true }, description: { type: 'STRING', nullable: true }, quantity: { type: 'NUMBER', nullable: true },
    missing: { type: 'ARRAY', maxItems: 4, items: { type: 'STRING', enum: ['buyer', 'description', 'quantity'] } },
  }, ['buyer', 'description', 'quantity', 'missing'])
  const result = await callGemini(makePrompt('document', fixture), resultSchema, options)
  if (Object.keys(result).some((key) => !['buyer', 'description', 'quantity', 'missing'].includes(key))) throw new DemoError('invalid_provider_response', 502)
  const fixtureFields = { buyer: null, description: 'workshop days', quantity: 2 }
  const normalizeString = (value, field, maxChars) => {
    if (value === null || fixtureFields[field] === null) return null
    if (typeof value !== 'string') throw new DemoError('invalid_provider_response', 502)
    const normalized = value.trim().toLocaleLowerCase('en-US')
    return normalized === fixtureFields[field].toLocaleLowerCase('en-US') && value.length <= maxChars ? fixtureFields[field] : null
  }
  const buyer = normalizeString(result.buyer, 'buyer', 120)
  const description = normalizeString(result.description, 'description', 160)
  const quantity = result.quantity === null ? null : Number.isInteger(result.quantity) && result.quantity === fixtureFields.quantity ? fixtureFields.quantity : null
  if (!Array.isArray(result.missing) || result.missing.some((field) => !['buyer', 'description', 'quantity'].includes(field))) throw new DemoError('invalid_provider_response', 502)
  const missing = Object.entries({ buyer, description, quantity }).filter(([, fieldValue]) => fieldValue === null).map(([field]) => field)
  return { status: 'live', source: 'gemini', model: GEMINI_MODEL, suggestion: { buyer, description, quantity, missing } }
}

export const FIXTURES = Object.freeze({ chat: Object.keys(CHAT_FIXTURES), agent: 'synthetic_document_task', document: 'workshop_quote' })
