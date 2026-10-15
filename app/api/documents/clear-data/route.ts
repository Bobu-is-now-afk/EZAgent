import { documentStoreForContext, DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../lib/documents/api'
import { isRecord } from '../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function DELETE(request: Request) {
  return handleDocumentApi(request, async (apiContext) => {
    const body = await readDocumentJson(request)
    if (!isRecord(body) || Object.keys(body).some((key) => key !== 'confirm') || body.confirm !== true) {
      throw new DocumentApiError('confirmation_required', 'Confirm deletion of all local synthetic document data.', 400)
    }
    return await (await documentStoreForContext(apiContext)).clearData()
  }, true)
}
