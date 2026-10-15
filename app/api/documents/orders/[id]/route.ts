import { DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../../lib/documents/api'
import { createDocumentStore } from '../../../../../lib/documents/store'
import { isRecord, parseOrderWrite } from '../../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export function GET(request: Request, context: Context) {
  return handleDocumentApi(request, async () => {
    const { id } = await context.params
    const revisionText = new URL(request.url).searchParams.get('revision')
    let revision: number | undefined
    if (revisionText !== null) {
      if (!/^\d{1,9}$/.test(revisionText) || Number(revisionText) < 1) throw new DocumentApiError('invalid_revision', 'Order revision must be a positive integer.', 400)
      revision = Number(revisionText)
    }
    const result = await (await createDocumentStore()).getOrder(id, revision)
    return revision === undefined ? result : { order: result.order }
  })
}

export function PUT(request: Request, context: Context) {
  return handleDocumentApi(request, async () => {
    const { id } = await context.params
    const parsed = parseOrderWrite(await readDocumentJson(request), true)
    if (!parsed || parsed.expectedRevision === null) throw new DocumentApiError('invalid_order', 'Order update failed strict validation.', 400)
    const order = await (await createDocumentStore()).updateOrder(id, parsed.expectedRevision, parsed.input)
    return { order }
  }, true)
}

export function DELETE(request: Request, context: Context) {
  return handleDocumentApi(request, async () => {
    const { id } = await context.params
    const body = await readDocumentJson(request)
    if (!isRecord(body) || Object.keys(body).some((key) => !['expectedRevision', 'confirm'].includes(key)) ||
        !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 1 || body.confirm !== true) {
      throw new DocumentApiError('confirmation_required', 'Confirm deletion of this order and include its current revision.', 400)
    }
    return (await createDocumentStore()).deleteOrArchiveOrder(id, body.expectedRevision as number)
  }, true)
}
