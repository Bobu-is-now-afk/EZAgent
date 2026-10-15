import { NextResponse, type NextRequest } from 'next/server'
import { guardNonDocumentApiPath } from './lib/documents/hosted-api-boundary'

/** Runs before every API route, so non-document handlers cannot execute in hosted mode. */
export function proxy(request: NextRequest) {
  return guardNonDocumentApiPath(request.nextUrl.pathname) ?? NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
