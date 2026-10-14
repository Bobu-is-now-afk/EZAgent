import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { authorizeDemoOperation } from '../../../lib/demo/api'

export const runtime = 'nodejs'
export async function GET(request: Request) {
  const ownerId = await authorizeDemoOperation(request, 'read')
  if (ownerId instanceof Response) return ownerId
  // Fixed synthetic fixture only; never accept a client-provided filesystem path.
  const content = await readFile(path.join(process.cwd(), 'data/demo/invoices-batch-1.csv'), 'utf8')
  return Response.json({ name: '示範發票.csv', type: 'csv', content })
}
