import { requestOwnerId, unauthorizedDemoResponse } from './access-control'
import { acquireDemoModelSlot, demoLimitResponse, reserveDemoOperation, type DemoOperation } from './limits'

export async function authorizeDemoOperation(request: Request, operation: DemoOperation): Promise<string | Response> {
  const ownerId = requestOwnerId(request)
  if (!ownerId) return unauthorizedDemoResponse()
  if (ownerId !== 'local') {
    try {
      await reserveDemoOperation(ownerId, operation)
    } catch (error) {
      return demoLimitResponse(error) ?? Response.json({ error: { code: 'demo_unavailable', message: 'The online demo is unavailable.' } }, { status: 503 })
    }
  }
  return ownerId
}

export async function runDemoModelOperation(request: Request, handler: () => Promise<Response>): Promise<Response> {
  const ownerId = requestOwnerId(request)
  if (!ownerId) return unauthorizedDemoResponse()
  let releaseSlot: (() => void) | null = null
  try {
    releaseSlot = acquireDemoModelSlot()
    if (ownerId !== 'local') await reserveDemoOperation(ownerId, 'model')
    const response = await handler()
    if (!response.body) {
      releaseSlot()
      return response
    }
    const reader = response.body.getReader()
    const release = () => { releaseSlot?.(); releaseSlot = null }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read()
          if (result.done) {
            release()
            controller.close()
          } else controller.enqueue(result.value)
        } catch (error) {
          release()
          controller.error(error)
        }
      },
      async cancel(reason) {
        try { await reader.cancel(reason) } finally { release() }
      },
    })
    void reader.closed.then(release, release)
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) {
    releaseSlot?.()
    return demoLimitResponse(error) ?? Response.json({ error: { code: 'demo_unavailable', message: 'The online demo is unavailable.' } }, { status: 503 })
  }
}

export function demoOperationErrorResponse(error: unknown): Response | null {
  return demoLimitResponse(error)
}
