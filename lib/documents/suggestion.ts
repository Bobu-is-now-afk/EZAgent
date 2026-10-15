import { localAiConfig } from '../local-ai/config'
import type { DocumentDraft, DraftSuggestion, SuggestionField } from './contracts'
import { DocumentStore, DocumentStoreError } from './store'
import { validateDraftForReview } from './validation'
import { isRecord } from './validation'

const MAX_DESCRIPTION_LENGTH = 2_000
const MAX_MODEL_OUTPUT_LENGTH = 8_192
const MODEL_CONTEXT_TOKENS = 2_048
const SUGGESTION_TIMEOUT_MS = 30_000
const suggestionState = globalThis as typeof globalThis & { __ezagentDocumentSuggestionBusy?: boolean }
const PROTECTED_CLAIM = /\b(?:HKD|TWD|USD|EUR|GBP|JPY|CNY|RMB|price|cost|fee|amount|payment|payable|paid|bank|account|tax|vat|invoice\s*(?:number|no\.?))\b|[$€£¥￥₹]|[0-9０-９]+|港幣|台幣|新台幣|美元|人民幣|金額|金额|付款|收款|支付|匯款|汇款|轉帳|转账|銀行|银行|帳戶|账户|戶口|稅額|税额/i

type LocalModelConfig = { model: string; host: string }
type SuggestionDeps = {
  fetcher?: typeof fetch
  configProvider?: () => Promise<LocalModelConfig>
  timeoutMs?: number
}

export class SuggestionError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'SuggestionError'
    this.code = code
    this.status = status
  }
}

const suggestionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object', additionalProperties: false,
        required: ['path', 'value', 'sourceExcerpt'],
        properties: {
          path: { type: 'string', enum: ['termsText', 'items[].description'] },
          value: { type: 'string', minLength: 1, maxLength: 500 },
          sourceExcerpt: { type: 'string', minLength: 1, maxLength: 240 },
        },
      },
    },
  },
} as const

export function validateSuggestionFields(value: unknown, description: string): SuggestionField[] | null {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'fields') || !Array.isArray(value.fields) || value.fields.length > 8) return null
  const fields: SuggestionField[] = []
  let hasTerms = false
  for (const raw of value.fields) {
    if (!isRecord(raw) || Object.keys(raw).some((key) => !['path', 'value', 'sourceExcerpt'].includes(key)) ||
        !['path', 'value', 'sourceExcerpt'].every((key) => key in raw) ||
        (raw.path !== 'termsText' && raw.path !== 'items[].description') ||
        typeof raw.value !== 'string' || typeof raw.sourceExcerpt !== 'string') return null
    const text = raw.value.trim()
    const excerpt = raw.sourceExcerpt.trim()
    if (!text || text.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ||
        !excerpt || excerpt.length > 240 || !description.includes(excerpt)) return null
    if (PROTECTED_CLAIM.test(text)) return null
    if (raw.path === 'termsText') {
      if (hasTerms) return null
      hasTerms = true
    }
    fields.push({ path: raw.path, value: text, sourceExcerpt: excerpt })
  }
  return fields
}

function missingFields(draft: DocumentDraft): string[] {
  return validateDraftForReview(draft)
}

function installedModel(models: unknown, modelName: string): boolean {
  if (!isRecord(models) || !Array.isArray(models.models)) return false
  return models.models.some((entry) => isRecord(entry) && entry.name === modelName)
}

export function createSuggestionService(deps: SuggestionDeps = {}) {
  const fetcher = deps.fetcher ?? fetch
  const configProvider = deps.configProvider ?? localAiConfig
  const timeoutMs = deps.timeoutMs ?? SUGGESTION_TIMEOUT_MS

  return async function suggest(input: {
    draft: DocumentDraft
    description: string
    store: DocumentStore
    signal?: AbortSignal
  }): Promise<DraftSuggestion> {
    const description = input.description.trim()
    if (!description || description.length > MAX_DESCRIPTION_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) {
      throw new SuggestionError('invalid_description', `Description must contain 1 to ${MAX_DESCRIPTION_LENGTH} safe text characters.`, 400)
    }
    let config: LocalModelConfig
    try { config = await configProvider() } catch { throw new SuggestionError('local_ai_unavailable', 'Local AI configuration is unavailable.', 503) }
    if (suggestionState.__ezagentDocumentSuggestionBusy) throw new SuggestionError('model_busy', 'A document suggestion is already running.', 429)
    suggestionState.__ezagentDocumentSuggestionBusy = true
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    if (input.signal?.aborted) {
      suggestionState.__ezagentDocumentSuggestionBusy = false
      throw new SuggestionError('request_cancelled', 'Suggestion request was cancelled.', 499)
    }
    input.signal?.addEventListener('abort', abortFromCaller, { once: true })
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      let modelsResponse: Response
      try {
        modelsResponse = await fetcher(`${config.host}/api/tags`, { cache: 'no-store', signal: controller.signal })
      } catch {
        if (timedOut) throw new SuggestionError('suggestion_timeout', 'The local model took too long to respond.', 504)
        if (input.signal?.aborted) throw new SuggestionError('request_cancelled', 'Suggestion request was cancelled.', 499)
        throw new SuggestionError('local_ai_unavailable', 'Could not reach the local Ollama service.', 503)
      }
      if (!modelsResponse.ok) throw new SuggestionError('local_ai_unavailable', 'The local model list could not be read.', 503)
      let models: unknown
      try { models = await modelsResponse.json() } catch { throw new SuggestionError('local_ai_unavailable', 'The local model list was unreadable.', 503) }
      if (!installedModel(models, config.model)) throw new SuggestionError('model_missing', 'The configured local model is not installed.', 409)

      let response: Response
      try {
        response = await fetcher(`${config.host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            think: false,
            format: suggestionSchema,
            options: { temperature: 0, num_predict: 512, num_ctx: MODEL_CONTEXT_TOKENS },
            messages: [
              { role: 'system', content: 'Return only schema-valid candidate wording for item descriptions or general terms. Do not decide or output buyer identity, quantity, price, currency, tax, payment status, payment amount, bank details, or dates. Leave missing facts to a human. Use only the supplied source description. Every sourceExcerpt must be an exact substring of it.' },
              { role: 'user', content: description },
            ],
          }),
          cache: 'no-store',
          signal: controller.signal,
        })
      } catch {
        if (timedOut) throw new SuggestionError('suggestion_timeout', 'The local model took too long to respond.', 504)
        if (input.signal?.aborted) throw new SuggestionError('request_cancelled', 'Suggestion request was cancelled.', 499)
        throw new SuggestionError('local_ai_unavailable', 'The local model could not complete the suggestion.', 503)
      }
      if (!response.ok) throw new SuggestionError(response.status === 404 ? 'model_missing' : 'local_ai_unavailable', 'The local model could not complete the suggestion.', response.status === 404 ? 409 : 503)
      let payload: unknown
      try { payload = await response.json() } catch { throw new SuggestionError('invalid_model_proposal', 'The local model returned an unreadable proposal.', 502) }
      if (!isRecord(payload) || !isRecord(payload.message) || typeof payload.message.content !== 'string' || payload.message.content.length > MAX_MODEL_OUTPUT_LENGTH) {
        throw new SuggestionError('invalid_model_proposal', 'The local model returned an invalid proposal.', 502)
      }
      let parsed: unknown
      try { parsed = JSON.parse(payload.message.content) } catch { throw new SuggestionError('invalid_model_proposal', 'The local model returned invalid JSON.', 502) }
      const fields = validateSuggestionFields(parsed, description)
      if (!fields) throw new SuggestionError('invalid_model_proposal', 'The local model proposal failed strict validation.', 502)
      try {
        return await input.store.addSuggestion({
          draftId: input.draft.id,
          baseRevision: input.draft.revision,
          fields,
          missingFields: missingFields(input.draft),
        })
      } catch (error) {
        if (error instanceof DocumentStoreError) throw error
        throw new SuggestionError('local_ai_unavailable', 'The suggestion could not be saved.', 500)
      }
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abortFromCaller)
      suggestionState.__ezagentDocumentSuggestionBusy = false
    }
  }
}
