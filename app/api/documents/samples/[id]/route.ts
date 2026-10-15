import { handleDocumentApi } from '../../../../../lib/documents/api'
import { createDocumentStore } from '../../../../../lib/documents/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export function GET(request: Request, context: Context) {
  return handleDocumentApi(request, async () => {
    const { id } = await context.params
    return { sample: await (await createDocumentStore()).getSample(id) }
  })
}
