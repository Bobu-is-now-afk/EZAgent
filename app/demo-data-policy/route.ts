import { DEMO_DATA_POLICY } from '../../lib/demo/data-policy'

export const dynamic = 'force-static'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export async function GET(): Promise<Response> {
  const sections = DEMO_DATA_POLICY.sections.map(({ heading, body }) => `<section><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(body)}</p></section>`).join('\n')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(DEMO_DATA_POLICY.title)}</title></head><body><main><h1>${escapeHtml(DEMO_DATA_POLICY.title)}</h1><p>Policy revision: ${escapeHtml(DEMO_DATA_POLICY.revision)}</p>${sections}</main></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-EZAgent-Policy-Revision': DEMO_DATA_POLICY.revision, 'X-Content-Type-Options': 'nosniff' } })
}
