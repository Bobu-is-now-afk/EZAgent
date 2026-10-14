import { authorizeDemoOperation } from '../../../../../lib/demo/api'
import { demoPlanQueue } from '../../../../../lib/demo/jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'read')
  if (ownerId instanceof Response) return ownerId
  const { id } = await context.params
  const job = await demoPlanQueue.get(id, ownerId)
  if (!job) return Response.json({ error: { code: 'job_not_found', message: 'Demo job does not exist.' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return Response.json({ job }, { headers: { 'Cache-Control': 'no-store', ...(job.position && job.position > 1 ? { 'Retry-After': '5' } : {}) } })
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'write')
  if (ownerId instanceof Response) return ownerId
  const { id } = await context.params
  const job = await demoPlanQueue.get(id, ownerId)
  if (!job) return Response.json({ error: { code: 'job_not_found', message: 'Demo job does not exist.' } }, { status: 404 })
  if (!['queued', 'running', 'cancelling', 'cancelled'].includes(job.status)) {
    return Response.json({ error: { code: 'job_not_cancellable', message: 'This demo job has already finished.' } }, { status: 409 })
  }
  const cancelled = await demoPlanQueue.cancel(id, ownerId)
  if (!cancelled) return Response.json({ error: { code: 'job_not_found', message: 'Demo job does not exist.' } }, { status: 404 })
  return Response.json({ job: cancelled }, { headers: { 'Cache-Control': 'no-store' } })
}
