import { createResumePostHandler } from '../../../../../../lib/agent/run-service'
import { authorizeDemoOperation } from '../../../../../../lib/demo/api'

export const runtime = 'nodejs'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'run')
  if (ownerId instanceof Response) return ownerId
  const { id } = await context.params
  return createResumePostHandler()(request, id, ownerId)
}
