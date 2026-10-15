import { documentStoreForContext, handleDocumentApi } from '../../../../../lib/documents/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export function GET(request: Request, context: Context) {
  return handleDocumentApi(request, async (apiContext) => {
    const { id } = await context.params
    return { sample: await (await documentStoreForContext(apiContext)).getSample(id) }
  })
}
