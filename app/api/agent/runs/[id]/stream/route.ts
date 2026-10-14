import { createRunStreamResponse } from '../../../../../../lib/agent/run-stream'
import { agentRunService } from '../../../../../../lib/agent/run-service'
import { authorizeDemoOperation } from '../../../../../../lib/demo/api'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'read')
  if (ownerId instanceof Response) return ownerId
  const { id } = await context.params
  if (!(await agentRunService.getOwnedRun(id, ownerId))) return Response.json({ error: { code: 'run_not_found', message: 'Run does not exist.' } }, { status: 404 })
  const cursor = new URL(request.url).searchParams.get('after') ?? '0'
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
    return Response.json({ error: { code: 'invalid_cursor', message: 'Event cursor is invalid.' } }, { status: 400 })
  }
  return createRunStreamResponse(request, id, Number(cursor))
}
