import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createGateway } from '../scripts/model_gateway.mjs'

const KEY = 'test-only-secret-0123456789abcdef-0123456789'

async function withGateway(options, run) {
  const server = createGateway({ apiKey: KEY, ...options })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await run(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function chat(base, body = { messages: [{ role: 'user', content: 'hello' }] }, key = KEY) {
  return fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('refuses missing secret and a non-loopback Ollama target', () => {
  assert.throws(() => createGateway({}), /MODEL_GATEWAY_API_KEY/)
  assert.throws(() => createGateway({ apiKey: KEY, ollamaUrl: 'https://example.com' }), /loopback/)
})

test('authenticates, fixes the model, and sends only to loopback Ollama', async () => {
  let seen
  await withGateway({ fetchImpl: async (url, options) => {
    seen = { url, body: JSON.parse(options.body) }
    return Response.json({ choices: [{ message: { content: 'reply' } }] })
  } }, async (base) => {
    assert.equal((await chat(base, undefined, 'wrong')).status, 401)
    assert.equal((await fetch(`${base}/healthz`)).status, 401)
    assert.equal((await fetch(`${base}/healthz`, { headers: { authorization: `Bearer ${KEY}` } })).status, 200)
    const response = await chat(base)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).choices[0].message.content, 'reply')
  })
  assert.equal(seen.url, 'http://127.0.0.1:11434/v1/chat/completions')
  assert.equal(seen.body.model, 'qwen3.5:9b')
  assert.equal(seen.body.stream, false)
})

test('rejects unsupported model, streaming, and oversized input', async () => {
  await withGateway({ fetchImpl: async () => { throw new Error('must not call Ollama') } }, async (base) => {
    assert.equal((await chat(base, { model: 'other', messages: [{ role: 'user', content: 'hello' }] })).status, 400)
    assert.equal((await chat(base, { stream: true, messages: [{ role: 'user', content: 'hello' }] })).status, 400)
    assert.equal((await chat(base, { messages: [{ role: 'user', content: 'x'.repeat(33_000) }] })).status, 413)
  })
})

test('permits only one in-flight model call', async () => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  await withGateway({ fetchImpl: async () => {
    await pending
    return Response.json({ choices: [] })
  } }, async (base) => {
    const first = chat(base)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal((await chat(base)).status, 429)
    release()
    assert.equal((await first).status, 200)
  })
})

test('caps upstream response even without content-length', async () => {
  await withGateway({ fetchImpl: async () => new Response('x'.repeat(1_048_577)) }, async (base) => {
    assert.equal((await chat(base)).status, 502)
  })
})

test('limits the number of model calls per minute', async () => {
  await withGateway({ fetchImpl: async () => Response.json({ choices: [] }) }, async (base) => {
    for (let index = 0; index < 12; index += 1) {
      assert.equal((await chat(base)).status, 200)
    }
    assert.equal((await chat(base)).status, 429)
  })
})
