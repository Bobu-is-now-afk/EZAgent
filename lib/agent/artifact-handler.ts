import { agentRunService, runServiceErrorResponse, type AgentRunService } from './run-service'
import { authorizeDemoOperation } from '../demo/api'

export function createArtifactGetHandler(
  service: AgentRunService = agentRunService,
  authorize: typeof authorizeDemoOperation = authorizeDemoOperation,
) {
  return async function handleArtifactGet(_request: Request, context: { params: Promise<{ id: string; artifactId: string }> }): Promise<Response> {
    const ownerId = await authorize(_request, 'read')
    if (ownerId instanceof Response) return ownerId
    try {
      const { id, artifactId } = await context.params
      const result = await service.readArtifact(id, artifactId, ownerId)
      if (!result) return Response.json({ error: { code: 'artifact_not_found', message: 'CSV artifact does not exist.' } }, { status: 404 })
      return new Response(new Uint8Array(result.contents), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="invoice-export-${id}.csv"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      return runServiceErrorResponse(error)
    }
  }
}
