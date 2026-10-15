import { readDocumentRuntimeMode } from './runtime-mode'

/**
 * Deny every non-document API before its route handler runs outside explicit
 * local mode. The document API keeps its own hosted session/local-origin gate.
 */
export function guardNonDocumentApiPath(pathname: string, env: NodeJS.ProcessEnv = process.env): Response | null {
  if (!pathname.startsWith('/api/')) return null
  if (pathname === '/api/documents' || pathname.startsWith('/api/documents/')) return null
  if (readDocumentRuntimeMode(env) === 'local') return null
  return Response.json({ error: { code: 'hosted_api_unavailable', message: 'This API is unavailable outside local mode.' } }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
