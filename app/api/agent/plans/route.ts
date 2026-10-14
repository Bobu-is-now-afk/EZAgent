import { createPlanPostHandler } from '../../../../lib/agent/planner'
import { runDemoModelOperation } from '../../../../lib/demo/api'

export const runtime = 'nodejs'
const handlePlan = createPlanPostHandler()

export async function POST(request: Request): Promise<Response> {
  return runDemoModelOperation(request, () => handlePlan(request))
}
