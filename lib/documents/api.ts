import { isLocalRequest } from '../local-ai/request'
import { DocumentStoreError } from './store'
import { SuggestionError } from './suggestion'
import { readHostedDocumentConfig } from './hosted-config'
import { HostedControlError } from './hosted-control'
import { resolveHostedRequest } from './hosted-session'
import { createDocumentStore, createHostedOwnerStore } from './store'
import { readDocumentRuntimeMode } from './runtime-mode'

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

export async function readDocumentJson(request: Request, maxBytes = MAX_DOCUMENT_REQUEST_BYTES): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
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
      if (size > maxBytes) {
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
  if (readDocumentRuntimeMode() !== 'local') return responseError('hosted_documents_unavailable', 'Hosted document access is unavailable.', 503)
  if (readHostedDocumentConfig().mode !== 'disabled') return responseError('hosted_documents_unavailable', 'Hosted document access is unavailable.', 503)
  if (!isLocalRequest(request, mutation)) return responseError('local_only', 'Document APIs are available only from the local app.', 403)
  if (process.env.EZAGENT_DOCUMENTS_ENABLED !== '1') return responseError('documents_disabled', 'The document workbench is disabled for this server.', 503)
  return null
}

export type DocumentApiContext = { hosted: boolean; ownerId?: string; config?: import('./hosted-config').HostedDocumentConfig }

export async function documentStoreForContext(context: DocumentApiContext) {
  if (context.hosted) {
    if (!context.ownerId) throw new DocumentApiError('hosted_owner_missing', 'Hosted document owner is unavailable.', 503)
    return createHostedOwnerStore(context.ownerId)
  }
  return createDocumentStore()
}

export async function handleDocumentApi<T>(request: Request, operation: (context: DocumentApiContext) => Promise<T>, mutation = false): Promise<Response> {
  if (Buffer.byteLength(request.url, 'utf8') > 2 * 1024) return responseError('url_too_large', 'Request URL exceeds the document API limit.', 414)
  const runtimeMode = readDocumentRuntimeMode()
  if (runtimeMode === 'invalid') return responseError('hosted_documents_unavailable', 'Document access is unavailable.', 503)
  const configResult = readHostedDocumentConfig()
  let context: DocumentApiContext
  if (configResult.mode === 'invalid') return responseError('hosted_documents_unavailable', 'Hosted document access is unavailable.', 503)
  if (runtimeMode === 'hosted') {
    if (configResult.mode !== 'enabled') return responseError('hosted_documents_unavailable', 'Hosted document access is unavailable.', 503)
    const hosted = await resolveHostedRequest(request, mutation)
    if (hosted.mode === 'unavailable') return hosted.response
    if (hosted.mode !== 'authenticated') return responseError('hosted_session_required', 'A hosted demo session is required.', 401)
    context = { hosted: true, ownerId: hosted.session.ownerId, config: hosted.config }
  } else {
    if (configResult.mode !== 'disabled') return responseError('hosted_documents_unavailable', 'Hosted document access is unavailable.', 503)
    const denied = localDocumentsGuard(request, mutation)
    if (denied) return denied
    context = { hosted: false }
  }
  try {
    return responseData(await operation(context))
  } catch (error) {
    if (error instanceof DocumentApiError) return responseError(error.code, error.message, error.status)
    if (error instanceof DocumentStoreError) return responseError(error.code, error.message, error.status)
    if (error instanceof SuggestionError) return responseError(error.code, error.message, error.status)
    if (error instanceof HostedControlError) return responseError(error.code, error.message, error.status)
    if (request.signal.aborted) return responseError('request_cancelled', 'Document request was cancelled.', 499)
    return responseError('document_service_error', 'Document request could not be completed.', 500)
  }
}
