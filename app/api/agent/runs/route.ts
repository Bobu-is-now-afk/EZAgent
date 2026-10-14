import { createRunPostHandler } from '../../../../lib/agent/run-service'
import { authorizeDemoOperation } from '../../../../lib/demo/api'
import { demoPlanQueue } from '../../../../lib/demo/jobs'
import { matchesCompletedPlanBinding } from '../../../../lib/demo/plan-binding'

export const runtime = 'nodejs'

const handleCreateRun = createRunPostHandler()

export async function POST(request: Request): Promise<Response> {
  const ownerId = await authorizeDemoOperation(request, 'run')
  if (ownerId instanceof Response) return ownerId
  if (ownerId !== 'local') {
    let body: unknown
    try {
      body = await request.clone().json()
    } catch {
      return Response.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: { code: 'replan_required', message: 'Create a new plan for this exact source.' } }, { status: 409 })
    }
    const input = body as Record<string, unknown>
    const binding = input.planBinding
    const source = input.source
    if (!binding || typeof binding !== 'object' || Array.isArray(binding) || !source || typeof source !== 'object' || Array.isArray(source)) {
      return Response.json({ error: { code: 'replan_required', message: 'Create a new plan for this exact source.' } }, { status: 409 })
    }
    const plan = binding as Record<string, unknown>
    const selected = source as Record<string, unknown>
    if (typeof plan.jobId !== 'string' || plan.planVersion !== 1 || typeof plan.sourceSha256 !== 'string' ||
        typeof selected.name !== 'string' || (selected.type !== 'csv' && selected.type !== 'text') || typeof selected.content !== 'string') {
      return Response.json({ error: { code: 'replan_required', message: 'Create a new plan for this exact source.' } }, { status: 409 })
    }
    const completedPlan = await demoPlanQueue.get(plan.jobId, ownerId).catch(() => null)
    if (!matchesCompletedPlanBinding({ job: completedPlan, binding, source })) {
      return Response.json({ error: { code: 'replan_required', message: 'Source changed; create a new plan for this exact source.' } }, { status: 409 })
    }
  }
  return handleCreateRun(request, ownerId)
}
