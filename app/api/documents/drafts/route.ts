import { DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../lib/documents/api'
import { createDocumentStore } from '../../../../lib/documents/store'
import { parseDraftCreate } from '../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleDocumentApi(request, async () => ({ drafts: await (await createDocumentStore()).listDrafts() }))
}

export function POST(request: Request) {
  return handleDocumentApi(request, async () => {
    const input = parseDraftCreate(await readDocumentJson(request))
    if (!input) throw new DocumentApiError('invalid_draft', 'Draft creation fields failed strict validation.', 400)
    const draft = await (await createDocumentStore()).createDraft(input.type, input.sourceOrder)
    return { draft }
  }, true)
}
