import { createHostedSessionResponse, getHostedSessionResponse, revokeHostedSessionResponse } from '../../../../lib/documents/hosted-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return getHostedSessionResponse(request)
}

export function POST(request: Request) {
  return createHostedSessionResponse(request)
}

export function DELETE(request: Request) {
  return revokeHostedSessionResponse(request)
}
