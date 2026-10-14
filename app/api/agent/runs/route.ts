import { createRunPostHandler } from '../../../../lib/agent/run-service'
import { authorizeDemoOperation } from '../../../../lib/demo/api'

export const runtime = 'nodejs'

const handleCreateRun = createRunPostHandler()

export async function POST(request: Request): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'run')
  if (ownerId instanceof Response) return ownerId
  return handleCreateRun(request, ownerId)
}
