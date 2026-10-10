import { createRunStreamResponse } from '../../../../../../lib/agent/run-stream'

export const runtime = 'nodejs'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const cursor = new URL(request.url).searchParams.get('after') ?? '0'
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
    return Response.json({ error: { code: 'invalid_cursor', message: 'Event cursor is invalid.' } }, { status: 400 })
  }
  return createRunStreamResponse(request, id, Number(cursor))
}
