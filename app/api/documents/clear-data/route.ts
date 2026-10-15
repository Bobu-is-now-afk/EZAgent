import { DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../lib/documents/api'
import { createDocumentStore } from '../../../../lib/documents/store'
import { isRecord } from '../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function DELETE(request: Request) {
  return handleDocumentApi(request, async () => {
    const body = await readDocumentJson(request)
    if (!isRecord(body) || Object.keys(body).some((key) => key !== 'confirm') || body.confirm !== true) {
      throw new DocumentApiError('confirmation_required', 'Confirm deletion of all local synthetic document data.', 400)
    }
    return await (await createDocumentStore()).clearData()
  }, true)
}
