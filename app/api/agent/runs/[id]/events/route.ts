import { agentRunService, runServiceErrorResponse } from '../../../../../../lib/agent/run-service'
import { authorizeDemoOperation } from '../../../../../../lib/demo/api'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'read')
  if (ownerId instanceof Response) return ownerId
  try {
    const { id } = await context.params
    const cursor = new URL(request.url).searchParams.get('after') ?? '0'
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
      return Response.json({ error: { code: 'invalid_cursor', message: 'Event cursor is invalid.' } }, { status: 400 })
    }
    if (!(await agentRunService.getOwnedRun(id, ownerId))) return Response.json({ error: { code: 'run_not_found', message: 'Run does not exist.' } }, { status: 404 })
    const result = await agentRunService.listEvents(id, Number(cursor))
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return runServiceErrorResponse(error)
  }
}
