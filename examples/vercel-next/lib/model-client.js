/** Copy this file into the teammate's Next.js project's lib/ directory. Server-only. */
import 'server-only'

export async function callModel({ messages, tools, tool_choice, temperature = 0.2, max_tokens = 512 }) {
  const endpoint = process.env.MODEL_API_URL
  const key = process.env.MODEL_API_KEY
  if (!endpoint || !key) throw new Error('MODEL_API_URL and MODEL_API_KEY must be set on the server')
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.pathname !== '/v1/chat/completions' || url.search || url.hash) {
    throw new Error('MODEL_API_URL must be the HTTPS gateway /v1/chat/completions endpoint')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: 'qwen3.5:9b', messages, tools, tool_choice,
      temperature, max_tokens, stream: false }),
    cache: 'no-store',
    signal: AbortSignal.timeout(50_000),
  })
  if (!response.ok) {
    // Do not log prompts, response bodies, or the key.
    const error = new Error('The demo model is unavailable or busy')
    error.status = response.status
    throw error
  }
  return response.json()
}
