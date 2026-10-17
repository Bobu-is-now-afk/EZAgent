import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 3011)
const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const key = process.env.GEMINI_API_KEY
const paths = new Map([['/', ['public/index.html', 'text/html; charset=utf-8']], ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['public/style.css', 'text/css; charset=utf-8']]])
const assets = new Map(await Promise.all([...paths].map(async ([url, [file, type]]) => [url, { body: await readFile(new URL(file, import.meta.url)), type }])))
let active = false
let windowStart = Date.now()
let calls = 0

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535')
if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid GEMINI_MODEL')

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(payload))
}

async function readJson(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 4096) throw new Error('request_too_large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('invalid_json') }
}

async function gemini(prompt, jsonMode) {
  if (!key) throw new Error('gemini_not_configured')
  if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); calls = 0 }
  if (active || calls >= 8) throw new Error('demo_busy')
  active = true
  calls++
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 600, temperature: 0.2, ...(jsonMode ? { responseMimeType: 'application/json' } : {}) } }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(response.status === 429 ? 'demo_busy' : 'gemini_unavailable')
    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim()
    if (!text) throw new Error('gemini_unavailable')
    return text
  } finally { active = false }
}

function validateSuggestion(raw) {
  let value
  try { value = JSON.parse(raw) } catch { throw new Error('invalid_suggestion') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['buyer', 'description', 'quantity', 'missing'].includes(k))) throw new Error('invalid_suggestion')
  const buyer = typeof value.buyer === 'string' ? value.buyer.slice(0, 100) : ''
  const description = typeof value.description === 'string' ? value.description.slice(0, 240) : ''
  const quantity = Number.isInteger(value.quantity) && value.quantity >= 1 && value.quantity <= 99 ? value.quantity : null
  const missing = Array.isArray(value.missing) ? value.missing.filter(x => typeof x === 'string').slice(0, 5).map(x => x.slice(0, 80)) : []
  return { buyer, description, quantity, missing }
}

createServer(async (req, res) => {
  if (req.method === 'GET' && assets.has(req.url)) {
    const asset = assets.get(req.url)
    res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'" })
    res.end(asset.body)
    return
  }
  if (req.method !== 'POST' || !['/api/chat', '/api/suggest'].includes(req.url)) return json(res, 404, { error: 'not_found' })
  if (req.headers.origin && req.headers.origin !== `http://${host}:${port}`) return json(res, 403, { error: 'invalid_origin' })
  try {
    const body = await readJson(req)
    const input = body?.text
    if (typeof input !== 'string' || !input.trim() || input.length > 1200) return json(res, 400, { error: 'invalid_input' })
    if (req.url === '/api/chat') {
      const answer = await gemini(`You are a concise assistant in an explicitly cloud-powered hackathon prototype. Answer in the language of the user. Do not claim to be a local model. User: ${input}`, false)
      return json(res, 200, { answer, provider: 'Gemini API' })
    }
    const instruction = `Extract only facts explicitly present in this request for a quotation draft. Return JSON only with keys buyer (string, blank if unknown), description (short string), quantity (integer or null), missing (array of short field names). Never infer or output a price, tax, bank account, exact date, or payment status. Text: ${input}`
    return json(res, 200, { suggestion: validateSuggestion(await gemini(instruction, true)), provider: 'Gemini API' })
  } catch (error) {
    const status = error.message === 'request_too_large' ? 413 : error.message === 'invalid_json' ? 400 : error.message === 'demo_busy' ? 429 : error.message === 'gemini_not_configured' ? 503 : 502
    json(res, status, { error: ['request_too_large', 'invalid_json', 'demo_busy', 'gemini_not_configured'].includes(error.message) ? error.message : 'gemini_unavailable' })
  }
}).listen(port, host, () => process.stdout.write(`Hackathon prototype: http://${host}:${port}\nGemini: ${key ? 'configured' : 'key missing — live AI disabled'}\n`))
