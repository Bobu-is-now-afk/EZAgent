import { documentStoreForContext, DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../../../lib/documents/api'
import { isRecord } from '../../../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export function POST(request: Request, context: Context) {
  return handleDocumentApi(request, async (apiContext) => {
    const { id } = await context.params
    const body = await readDocumentJson(request)
    if (!isRecord(body) || Object.keys(body).some((key) => !['expectedRevision', 'confirmedPaths'].includes(key)) ||
        !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 ||
        !Array.isArray(body.confirmedPaths) || body.confirmedPaths.length > 200 || body.confirmedPaths.some((path) => typeof path !== 'string')) {
      throw new DocumentApiError('invalid_review', 'Review must include the current revision and confirmed field paths.', 400)
    }
    const result = await (await documentStoreForContext(apiContext)).reviewDraft(id, body.expectedRevision as number, body.confirmedPaths as string[])
    return { draft: result.draft, totals: result.totals, review: { revision: result.draft.revision, digest: result.digest } }
  }, true)
}
