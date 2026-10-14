import { GET as getDemoDataPolicy } from '../../app/demo-data-policy/route'
import { verifyPublishedDemoPolicy } from './data-policy'

export async function isDemoPolicyAvailable(): Promise<boolean> {
  try {
    return await verifyPublishedDemoPolicy(await getDemoDataPolicy())
  } catch {
    return false
  }
}

export function demoPolicyUnavailableResponse(): Response {
  return Response.json({ error: { code: 'demo_policy_unavailable', message: 'The required demo data notice is unavailable.' } }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function gateDemoApiOnPolicy(
  pathname: string,
  method: string,
  policyReady: () => Promise<boolean> = isDemoPolicyAvailable,
): Promise<Response | null> {
  if (pathname === '/api/demo/capabilities' || pathname === '/api/demo/session' && method.toUpperCase() === 'DELETE') return null
  if (pathname === '/api/review' || pathname.startsWith('/api/review/')) return null
  if (await policyReady().catch(() => false)) return null
  return demoPolicyUnavailableResponse()
}
