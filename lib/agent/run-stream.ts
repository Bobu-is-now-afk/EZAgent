import { agentRunService, runServiceErrorResponse, type AgentRunService } from './run-service'

export function createRunStreamResponse(
  request: Request,
  runId: string,
  afterSequence = 0,
  service: AgentRunService = agentRunService,
  pollIntervalMs = 1_000,
  heartbeatIntervalMs = 15_000,
): Response {
  const encoder = new TextEncoder()
  let stopped = false
  let eventCursor = afterSequence
  let timer: ReturnType<typeof setTimeout> | undefined
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  let lastHeartbeat = Date.now()
  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    try { streamController?.close() } catch { /* Stream may already be closed. */ }
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      if (request.signal.aborted) { stop(); return }
      request.signal.addEventListener('abort', stop, { once: true })
      const poll = async () => {
        if (stopped) return
        try {
          const page = await service.listEvents(runId, eventCursor)
          if (stopped) return
          for (const event of page.events) {
            if (stopped) return
            eventCursor = event.sequence
            controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: RunEvent\ndata: ${JSON.stringify(event)}\n\n`))
          }
          const run = await service.getRun(runId)
          if (stopped) return
          if (!run) throw new Error('not_found')
          if (['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) {
            stopped = true
            controller.close()
            request.signal.removeEventListener('abort', stop)
            return
          }
          const now = Date.now()
          if (now - lastHeartbeat >= heartbeatIntervalMs) {
            controller.enqueue(encoder.encode(': heartbeat\n\n'))
            lastHeartbeat = now
          }
          timer = setTimeout(() => { void poll() }, pollIntervalMs)
        } catch (error) {
          if (stopped) return
          const response = runServiceErrorResponse(error)
          let message = 'Run event stream failed.'
          try {
            const payload = await response.json()
            if (payload?.error?.code === 'run_not_found') message = payload.error.message
          } catch { /* Keep stream errors generic. */ }
          if (!stopped) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: { code: 'stream_error', message } })}\n\n`))
            stopped = true
            controller.close()
            request.signal.removeEventListener('abort', stop)
          }
        }
      }
      void poll()
    },
    cancel() {
      stop()
      request.signal.removeEventListener('abort', stop)
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
