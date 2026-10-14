import { agentRunService, publicRunView, runServiceErrorResponse } from '../../../../../lib/agent/run-service'
import { authorizeDemoOperation } from '../../../../../lib/demo/api'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const ownerId = await authorizeDemoOperation(_request, 'read')
  if (ownerId instanceof Response) return ownerId
  try {
    const { id } = await context.params
    const run = await agentRunService.getOwnedRun(id, ownerId)
    if (!run) return Response.json({ error: { code: 'run_not_found', message: 'Run does not exist.' } }, { status: 404 })
    return Response.json({ run: publicRunView(run) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return runServiceErrorResponse(error)
  }
}
