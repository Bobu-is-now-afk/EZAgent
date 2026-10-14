import { DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../../lib/documents/api'
import { createDocumentStore } from '../../../../../lib/documents/store'
import { isRecord, parseDraftPatch } from '../../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export function GET(request: Request, context: Context) {
  return handleDocumentApi(request, async () => {
    const { id } = await context.params
    const result = await (await createDocumentStore()).getDraft(id)
    return result
  })
}

export function PATCH(request: Request, context: Context) {
  return handleDocumentApi(request, async () => {
    const { id } = await context.params
    const body = await readDocumentJson(request)
    if (!isRecord(body) || !Number.isSafeInteger(body.expectedRevision)) throw new DocumentApiError('invalid_draft', 'Draft update must include expectedRevision.', 400)
    const store = await createDocumentStore()
    const current = await store.getDraft(id)
    const parsed = parseDraftPatch(body, current.draft.currency)
    if (!parsed) throw new DocumentApiError('invalid_draft', 'Draft update failed strict validation.', 400)
    const draft = await store.patchDraft(id, parsed.expectedRevision, parsed.patch)
    return { draft, totals: (await store.getDraft(id)).totals }
  }, true)
}

export function DELETE(request: Request, context: Context) {
  return handleDocumentApi(request, async () => {
    const { id } = await context.params
    const body = await readDocumentJson(request)
    if (!isRecord(body) || Object.keys(body).some((key) => !['expectedRevision', 'confirm'].includes(key)) ||
        !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || body.confirm !== true) {
      throw new DocumentApiError('confirmation_required', 'Confirm deletion of this draft and include its current revision.', 400)
    }
    await (await createDocumentStore()).deleteDraft(id, body.expectedRevision as number)
    return { deleted: true, id }
  }, true)
}
