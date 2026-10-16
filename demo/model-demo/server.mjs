import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { checkOllamaModel } from './gateway.mjs'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 3007)
const OLLAMA = 'http://127.0.0.1:11434'
const MODEL = 'qwen3.5:9b'
const CATALOG = Object.freeze({ design: { label: 'Design session', price: 500 }, print: { label: 'Print preparation', price: 200 }, consult: { label: 'Consultation', price: 300 } })
const page = await readFile(new URL('./public/index.html', import.meta.url))

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('PORT must be 1024–65535')
await checkOllamaModel()

function send(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(data))
}

async function input(req, limit = 4096) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request_too_large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('invalid_json') }
}

let active = false
async function model(messages, tools) {
  if (active) throw new Error('model_busy')
  active = true
  try {
    const response = await fetch(`${OLLAMA}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, stream: false, max_tokens: 512, temperature: 0.2,
        ...(tools ? { tools, tool_choice: 'required' } : {}) }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) throw new Error('model_unavailable')
    return response.json()
  } finally { active = false }
}

const quoteTool = [{ type: 'function', function: { name: 'quote_line', description: 'Select one synthetic quote item and quantity. Never issue a real document.', parameters: { type: 'object', properties: { sku: { type: 'string', enum: Object.keys(CATALOG) }, quantity: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['sku', 'quantity'] } } }]

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(page)
    return
  }
  if (req.method !== 'POST' || !['/api/model', '/api/demo-agent'].includes(req.url)) return send(res, 404, { error: 'not_found' })
  const origin = req.headers.origin
  if (origin && origin !== `http://${HOST}:${PORT}`) return send(res, 403, { error: 'invalid_origin' })
  try {
    const body = await input(req)
    const isAgent = req.url === '/api/demo-agent'
    const prompt = isAgent ? body.request : body.prompt
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > (isAgent ? 1000 : 2000)) return send(res, 400, { error: 'invalid_prompt' })
    const messages = isAgent ? [
      { role: 'system', content: 'Create only a synthetic draft quotation. Call quote_line exactly once. Choose design, print or consultation. If vague, choose quantity 1. Never invent prices.' },
      { role: 'user', content: prompt },
    ] : [{ role: 'user', content: prompt }]
    const result = await model(messages, isAgent ? quoteTool : undefined)
    if (!isAgent) return send(res, 200, { answer: result.choices?.[0]?.message?.content ?? '' })
    const calls = result.choices?.[0]?.message?.tool_calls
    if (!Array.isArray(calls) || calls.length !== 1 || calls[0]?.function?.name !== 'quote_line') return send(res, 422, { error: 'draft_not_understood' })
    let args
    try { args = typeof calls[0].function.arguments === 'string' ? JSON.parse(calls[0].function.arguments) : calls[0].function.arguments } catch { return send(res, 422, { error: 'invalid_tool_arguments' }) }
    if (!args || !Object.hasOwn(CATALOG, args.sku) || !Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 10) return send(res, 422, { error: 'invalid_tool_arguments' })
    const item = CATALOG[args.sku]
    return send(res, 200, { demoOnly: true, draft: { status: 'draft_only', currency: 'HKD', sku: args.sku, description: item.label, quantity: args.quantity, unitPrice: item.price, total: item.price * args.quantity } })
  } catch (error) {
    const code = error.message === 'model_busy' ? 429 : error.message === 'request_too_large' ? 413 : error.message === 'invalid_json' ? 400 : 503
    send(res, code, { error: ['model_busy', 'request_too_large', 'invalid_json'].includes(error.message) ? error.message : 'model_unavailable' })
  }
})
server.requestTimeout = 10_000
server.listen(PORT, HOST, () => process.stdout.write(`Local demo: http://${HOST}:${PORT}\n`))
