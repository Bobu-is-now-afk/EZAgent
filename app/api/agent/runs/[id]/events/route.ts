import { agentRunService, runServiceErrorResponse } from '../../../../../../lib/agent/run-service'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params
    const cursor = new URL(request.url).searchParams.get('after') ?? '0'
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
      return Response.json({ error: { code: 'invalid_cursor', message: 'Event cursor is invalid.' } }, { status: 400 })
    }
    const result = await agentRunService.listEvents(id, Number(cursor))
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return runServiceErrorResponse(error)
  }
}
