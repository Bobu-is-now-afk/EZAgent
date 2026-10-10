import { isLocalRequest } from '../../../lib/local-ai/request'
import { spawn } from 'node:child_process'
import path from 'node:path'
import manifest from '../../../models.manifest.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const state = globalThis as typeof globalThis & { localAiPreparing?: boolean }


function bootstrap(args: string[], prepare = false) {
  const encoder = new TextEncoder()
  let child: ReturnType<typeof spawn>
  let timer: ReturnType<typeof setTimeout>
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let finished = false
      let pending = ''
      let emitted = false
      const finish = (failure?: string) => {
        if (finished || cancelled) return
        finished = true
        clearTimeout(timer)
        if (prepare) state.localAiPreparing = false
        if (failure) controller.enqueue(encoder.encode(JSON.stringify({ state: failure }) + '\n'))
        controller.close()
      }
      child = spawn(process.platform === 'win32' ? 'python' : 'python3', [path.join(process.cwd(), 'scripts/bootstrap_local.py'), '--json', ...args], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        if (finished || cancelled) return
        pending += chunk
        let boundary: number
        while ((boundary = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1)
          try { JSON.parse(line); emitted = true; controller.enqueue(encoder.encode(line + '\n')) } catch { /* never forward unstructured output */ }
        }
      })
      child.on('error', () => finish('runtime_missing'))
      child.on('close', () => finish(!emitted || pending ? 'failed' : undefined))
      timer = setTimeout(() => { child.kill(); finish('failed') }, prepare ? 31 * 60_000 : 15_000)
    },
    cancel() { cancelled = true; clearTimeout(timer); child?.kill(); if (prepare) state.localAiPreparing = false },
  })
}

export function GET(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ state: 'local_only' }, { status: 403 })
  return new Response(bootstrap(['--check-only']), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  if (!isLocalRequest(request, true)) return Response.json({ state: 'local_only' }, { status: 403 })
  let model: unknown
  try { model = (await request.json()).model } catch { return Response.json({ state: 'invalid_request' }, { status: 400 }) }
  if (!manifest.models.some((entry) => entry.id === model && !entry.blocked)) return Response.json({ state: 'hardware_blocked' }, { status: 400 })
  if (state.localAiPreparing) return Response.json({ state: 'busy' }, { status: 409 })
  state.localAiPreparing = true
  return new Response(bootstrap(['--yes', '--model', model as string], true), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } })
}
