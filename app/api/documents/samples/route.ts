import { handleDocumentApi } from '../../../../lib/documents/api'
import { createDocumentStore } from '../../../../lib/documents/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleDocumentApi(request, async () => ({ samples: await (await createDocumentStore()).listSamples() }))
}
