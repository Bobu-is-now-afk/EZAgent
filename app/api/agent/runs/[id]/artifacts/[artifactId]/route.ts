import { agentRunService, runServiceErrorResponse } from '../../../../../../../lib/agent/run-service'

export const runtime = 'nodejs'

export async function GET(_request: Request, context: { params: Promise<{ id: string; artifactId: string }> }): Promise<Response> {
  try {
    const { id, artifactId } = await context.params
    const result = await agentRunService.readArtifact(id, artifactId)
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
