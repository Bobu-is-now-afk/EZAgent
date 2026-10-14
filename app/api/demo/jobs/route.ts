import { authorizeDemoOperation } from '../../../../lib/demo/api'
import { demoPlanQueue } from '../../../../lib/demo/jobs'
import { demoLimitResponse, reserveDemoDailyUsage } from '../../../../lib/demo/limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'write')
  if (ownerId instanceof Response) return ownerId
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }
  try {
    const job = await demoPlanQueue.submit(ownerId, payload, () => ownerId === 'local' ? Promise.resolve() : reserveDemoDailyUsage(ownerId))
    return Response.json({ job }, {
      status: 202,
      headers: {
        'Cache-Control': 'no-store',
        'Location': `/api/demo/jobs/${job.id}`,
        ...(job.position && job.position > 1 ? { 'Retry-After': '5' } : {}),
      },
    })
  } catch (error) {
    const limited = demoLimitResponse(error)
    if (limited) return limited
    if (error instanceof Error && error.message === 'demo_queue_full') {
      return Response.json({ error: { code: 'demo_busy', message: 'The plan queue is full. Please wait and retry.' } }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } })
    }
    return Response.json({ error: { code: 'demo_unavailable', message: 'The demo job could not be accepted.' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
