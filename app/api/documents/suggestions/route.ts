import { DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../lib/documents/api'
import { createDocumentStore } from '../../../../lib/documents/store'
import { createSuggestionService } from '../../../../lib/documents/suggestion'
import { isRecord } from '../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const suggest = createSuggestionService()

export function POST(request: Request) {
  return handleDocumentApi(request, async () => {
    const body = await readDocumentJson(request)
    if (!isRecord(body) || Object.keys(body).some((key) => !['draftId', 'expectedRevision', 'description'].includes(key)) ||
        typeof body.draftId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.draftId) ||
        !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || typeof body.description !== 'string') {
      throw new DocumentApiError('invalid_suggestion_request', 'Suggestion request fields failed strict validation.', 400)
    }
    const store = await createDocumentStore()
    const current = await store.getDraft(body.draftId)
    if (current.draft.revision !== body.expectedRevision) throw new DocumentApiError('revision_conflict', 'Draft changed before the suggestion request.', 409)
    const suggestion = await suggest({ draft: current.draft, description: body.description, store, signal: request.signal })
    return { suggestion }
  }, true)
}
