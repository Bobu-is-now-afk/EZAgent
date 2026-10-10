import { createResumePostHandler } from '../../../../../../lib/agent/run-service'

export const runtime = 'nodejs'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  return createResumePostHandler()(request, id)
}
