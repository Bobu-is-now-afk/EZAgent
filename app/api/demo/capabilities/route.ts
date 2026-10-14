import { agentRunService } from '../../../../lib/agent/run-service'
import { localAiConfig } from '../../../../lib/local-ai/config'
import { demoConfig } from '../../../../lib/demo/access-control'
import { DEMO_LIMITS, isDemoModelBusy, reservePublicProbe } from '../../../../lib/demo/limits'
import { DEMO_PLAN_QUEUE, demoPlanQueue } from '../../../../lib/demo/jobs'
import { DEMO_DATA_POLICY_PATH, isPublishedDemoPolicy } from '../../../../lib/demo/data-policy'
import { isDemoPolicyAvailable } from '../../../../lib/demo/policy-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  if (!reservePublicProbe()) return Response.json({ error: { code: 'demo_rate_limited', message: 'Too many capability checks. Please wait before trying again.' } }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } })
  const config = demoConfig()
  const dataPolicyAvailable = Boolean(config && config.dataPolicyUrl === DEMO_DATA_POLICY_PATH && isPublishedDemoPolicy(config.dataPolicyUrl) &&
    await isDemoPolicyAvailable())
  const queue = config ? await demoPlanQueue.status().catch(() => ({ active: 0, queued: DEMO_PLAN_QUEUE.maxPending })) : { active: 0, queued: 0 }
  const base = {
    version: 1,
    session: { endpoint: '/api/demo/session', method: 'POST', cookie: 'ezagent_demo_session', httpOnly: true, sameSite: 'Strict' },
    dataPolicyUrl: config?.dataPolicyUrl ?? null,
    dataPolicyAvailable,
    requestLimits: {
      maxRequestBytes: DEMO_LIMITS.maxRequestBytes,
      maxRequestsPerSessionPerMinute: DEMO_LIMITS.maxSessionRequestsPerMinute,
      maxCallsPerVisitorPerUtcDay: DEMO_LIMITS.maxCallsPerVisitorPerUtcDay,
      maxCallsPerUtcDay: DEMO_LIMITS.maxCallsPerUtcDay,
      maxConcurrentModelCalls: DEMO_LIMITS.maxConcurrentModelCalls,
      maxConcurrentRuns: DEMO_LIMITS.maxConcurrentRuns,
    },
    queue: {
      maxConcurrent: DEMO_PLAN_QUEUE.maxConcurrent,
      maxPending: DEMO_PLAN_QUEUE.maxPending,
      active: queue.active,
      queued: queue.queued,
      full: queue.queued >= DEMO_PLAN_QUEUE.maxPending,
      maxQueueWaitMs: DEMO_PLAN_QUEUE.queueTimeoutMs,
      maxJobRuntimeMs: DEMO_PLAN_QUEUE.jobTimeoutMs,
      statusEndpoint: '/api/demo/jobs/{id}',
      cancelMethod: 'DELETE',
      pollAfterMs: 5_000,
    },
    capabilities: { chat: false, invoicePlan: false, invoicePlanQueue: false, invoiceRun: false, localModelSetup: false },
  }
  if (!config) {
    return Response.json({ ...base, status: 'disabled', message: 'The hosted demo has not passed its release gates.' }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (process.env.EZAGENT_DEMO_MAINTENANCE === '1') {
    return Response.json({ ...base, status: 'maintenance', message: 'The hosted demo is temporarily unavailable.' }, { headers: { 'Cache-Control': 'no-store' } })
  }

  if (!dataPolicyAvailable) {
    return Response.json({ ...base, status: 'stopped', message: 'The required demo data notice is unavailable.', capabilities: { chat: false, invoicePlan: false, invoicePlanQueue: false, invoiceRun: false, localModelSetup: false } }, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const { model, host } = await localAiConfig()
    const response = await fetch(`${host}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(1_500) })
    if (!response.ok) throw new Error('unavailable')
    const tags = await response.json() as { models?: Array<{ name?: unknown }> }
    if (!Array.isArray(tags.models) || !tags.models.some((entry) => entry?.name === model)) throw new Error('model_missing')
    const busy = agentRunService.hasActiveRun() || isDemoModelBusy() || queue.active > 0 || queue.queued > 0
    return Response.json({
      ...base,
      status: busy ? 'busy' : 'ready',
      message: busy ? 'The demo is processing another request; bounded queue and recovery are available.' : 'The hosted invoice demo is available.',
      capabilities: { chat: false, invoicePlan: true, invoicePlanQueue: true, invoiceRun: true, localModelSetup: false },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({
      ...base,
      status: 'stopped',
      message: 'The demo model is stopped or unavailable; existing jobs and runs can still be inspected or cancelled.',
      capabilities: { chat: false, invoicePlan: false, invoicePlanQueue: true, invoiceRun: true, localModelSetup: false },
    }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
