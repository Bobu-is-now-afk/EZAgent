import { agentRunService, runServiceErrorResponse } from '../../../../../lib/agent/run-service'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params
    const run = await agentRunService.getRun(id)
    if (!run) return Response.json({ error: { code: 'run_not_found', message: 'Run does not exist.' } }, { status: 404 })
    return Response.json({ run }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return runServiceErrorResponse(error)
  }
}
