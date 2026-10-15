import { documentStoreForContext, DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../lib/documents/api'
import { parseDraftCreate } from '../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleDocumentApi(request, async (apiContext) => ({ drafts: await (await documentStoreForContext(apiContext)).listDrafts() }))
}

export function POST(request: Request) {
  return handleDocumentApi(request, async (apiContext) => {
    const input = parseDraftCreate(await readDocumentJson(request))
    if (!input) throw new DocumentApiError('invalid_draft', 'Draft creation fields failed strict validation.', 400)
    const draft = await (await documentStoreForContext(apiContext)).createDraft(input.type, input.sourceOrder)
    return { draft }
  }, true)
}
