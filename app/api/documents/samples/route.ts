import { documentStoreForContext, handleDocumentApi } from '../../../../lib/documents/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleDocumentApi(request, async (apiContext) => ({ samples: await (await documentStoreForContext(apiContext)).listSamples() }))
}
