import { documentStoreForContext, DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../../../lib/documents/api'
import { isRecord } from '../../../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export function POST(request: Request, context: Context) {
  return handleDocumentApi(request, async (apiContext) => {
    const { id } = await context.params
    const body = await readDocumentJson(request)
    if (!isRecord(body) || Object.keys(body).some((key) => !['expectedRevision', 'suggestionId', 'fieldIndexes'].includes(key)) ||
        !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 ||
        typeof body.suggestionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.suggestionId) ||
        !Array.isArray(body.fieldIndexes) || body.fieldIndexes.length < 1 || body.fieldIndexes.length > 8 ||
        body.fieldIndexes.some((index) => !Number.isSafeInteger(index))) {
      throw new DocumentApiError('invalid_suggestion_selection', 'Select fields from the current suggestion.', 400)
    }
    const store = await documentStoreForContext(apiContext)
    const draft = await store.applySuggestion(id, body.expectedRevision as number, body.suggestionId, body.fieldIndexes as number[])
    return { draft, totals: (await store.getDraft(id)).totals }
  }, true)
}
