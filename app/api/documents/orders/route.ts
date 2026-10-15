import { documentStoreForContext, DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../lib/documents/api'
import { parseOrderWrite } from '../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleDocumentApi(request, async (apiContext) => ({ orders: await (await documentStoreForContext(apiContext)).listOrders() }))
}

export function POST(request: Request) {
  return handleDocumentApi(request, async (apiContext) => {
    const parsed = parseOrderWrite(await readDocumentJson(request), false)
    if (!parsed) throw new DocumentApiError('invalid_order', 'Order fields failed strict validation.', 400)
    const order = await (await documentStoreForContext(apiContext)).createOrder(parsed.input)
    return { order }
  }, true)
}
