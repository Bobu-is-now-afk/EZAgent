const disabled = () => Response.json({ status: 'error', error: 'scripted_demo_only' }, { status: 410, headers: { 'Cache-Control': 'no-store' } })
export function POST() { return disabled() }
export function GET() { return disabled() }
