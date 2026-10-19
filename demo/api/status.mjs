export function GET() {
  return Response.json({ configured: false, mode: 'scripted_demo', connectivity: 'not_applicable' }, { headers: { 'Cache-Control': 'no-store' } })
}
