import { isLocalRequest } from '../local-ai/request'
import { DocumentStoreError } from './store'
import { SuggestionError } from './suggestion'

export const MAX_DOCUMENT_REQUEST_BYTES = 64 * 1024

export class DocumentApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'DocumentApiError'
    this.code = code
    this.status = status
  }
}

export function responseData<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function responseError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function readDocumentJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_DOCUMENT_REQUEST_BYTES)) {
    throw new DocumentApiError('request_too_large', 'Request body exceeds the document API limit.', 413)
  }
  if (!request.body) throw new DocumentApiError('invalid_json', 'Request body must be valid JSON.', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_DOCUMENT_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new DocumentApiError('request_too_large', 'Request body exceeds the document API limit.', 413)
      }
      chunks.push(part.value)
    }
  } catch (error) {
    if (error instanceof DocumentApiError) throw error
    throw new DocumentApiError('invalid_json', 'Request body could not be read.', 400)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown } catch {
    throw new DocumentApiError('invalid_json', 'Request body must be valid JSON.', 400)
  }
}

export function localDocumentsGuard(request: Request, mutation = false): Response | null {
  if (!isLocalRequest(request, mutation)) return responseError('local_only', 'Document APIs are available only from the local app.', 403)
  if (process.env.EZAGENT_DOCUMENTS_ENABLED !== '1') return responseError('documents_disabled', 'The document workbench is disabled for this server.', 503)
  return null
}

export async function handleDocumentApi<T>(request: Request, operation: () => Promise<T>, mutation = false): Promise<Response> {
  const denied = localDocumentsGuard(request, mutation)
  if (denied) return denied
  try {
    return responseData(await operation())
  } catch (error) {
    if (error instanceof DocumentApiError) return responseError(error.code, error.message, error.status)
    if (error instanceof DocumentStoreError) return responseError(error.code, error.message, error.status)
    if (error instanceof SuggestionError) return responseError(error.code, error.message, error.status)
    if (request.signal.aborted) return responseError('request_cancelled', 'Document request was cancelled.', 499)
    return responseError('document_service_error', 'Document request could not be completed.', 500)
  }
}
