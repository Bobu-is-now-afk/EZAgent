import { documentStoreForContext, DocumentApiError, handleDocumentApi, readDocumentJson } from '../../../../../../lib/documents/api'
import { isRecord } from '../../../../../../lib/documents/validation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

export function POST(request: Request, context: Context) {
  return handleDocumentApi(request, async (apiContext) => {
    const { id } = await context.params
    const body = await readDocumentJson(request)
    const idempotencyKey = request.headers.get('idempotency-key')
    if (!isRecord(body) || Object.keys(body).some((key) => !['revision', 'reviewDigest', 'confirm'].includes(key)) ||
        !Number.isSafeInteger(body.revision) || (body.revision as number) < 1 ||
        typeof body.reviewDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.reviewDigest) ||
        body.confirm !== 'CREATE SAMPLE' || !idempotencyKey || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      throw new DocumentApiError('confirmation_required', 'Confirm sample creation with the reviewed revision and an idempotency key.', 400)
    }
    const result = await (await documentStoreForContext(apiContext)).createSample(id, body.revision as number, body.reviewDigest, idempotencyKey)
    return { sample: result.value, created: result.created === true }
  }, true)
}
