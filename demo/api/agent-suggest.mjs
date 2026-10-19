import { agentSuggest } from '../lib/gemini.mjs'
import { fail, json, methodNotAllowed, rateLimit, readJson } from '../lib/http.mjs'

export async function POST(request) {
  const limited = rateLimit()
  if (limited) return limited
  try { return json(await agentSuggest(await readJson(request))) } catch (error) { return fail(error) }
}

export function GET() { return methodNotAllowed() }
