import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { checkOllamaModel, createGateway } from '../scripts/model_gateway.mjs'

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

test('validates tool definitions, tool choice, and response format before forwarding', async () => {
  const tools = [{ type: 'function', function: {
    name: 'lookup_order', description: 'Look up one order',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  } }]
  let forwarded
  await withGateway({ fetchImpl: async (_url, options) => {
    forwarded = JSON.parse(options.body)
    return Response.json({ choices: [] })
  } }, async (base) => {
    const messages = [{ role: 'user', content: 'Find order 1' }]
    assert.equal((await chat(base, { messages, tools, tool_choice: 'auto', response_format: { type: 'json_object' } })).status, 200)
    assert.equal(forwarded.tools[0].function.name, 'lookup_order')
    assert.equal(forwarded.response_format.type, 'json_object')
    for (const bad of [
      { tools: [{ type: 'function', function: { name: 'bad name', parameters: { type: 'object' } } }] },
      { tools: [...tools, ...tools] },
      { tools, tool_choice: { type: 'function', function: { name: 'unknown' } } },
      { tool_choice: 'auto' },
      { response_format: { type: 'json_schema', json_schema: {} } },
      { temperature: 0.2, prompt: 'unknown top-level field' },
    ]) {
      assert.equal((await chat(base, { messages, ...bad })).status, 400)
    }
  })
})

test('allows a bounded assistant tool call and rejects malformed calls', async () => {
  let forwarded
  await withGateway({ fetchImpl: async (_url, options) => {
    forwarded = JSON.parse(options.body)
    return Response.json({ choices: [] })
  } }, async (base) => {
    const call = { id: 'call_1', type: 'function', function: { name: 'lookup_order', arguments: '{"id":"1"}' } }
    const messages = [{ role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"status":"found"}' }]
    assert.equal((await chat(base, { messages })).status, 200)
    assert.equal(forwarded.messages[0].tool_calls[0].id, 'call_1')
    assert.equal((await chat(base, { messages: [{ role: 'assistant', content: null,
      tool_calls: [{ ...call, function: { name: 'bad name', arguments: '{}' } }] }] })).status, 400)
    assert.equal((await chat(base, { messages: [{ role: 'assistant', content: 'text',
      tool_calls: [{ ...call, function: { name: 'bad name', arguments: '{}' } }] }] })).status, 400)
  })
})

test('preflight checks the installed model on loopback Ollama', async () => {
  let seen
  assert.equal(await checkOllamaModel({ fetchImpl: async (url) => {
    seen = url
    return Response.json({ models: [{ name: 'qwen3.5:9b' }] })
  } }), true)
  assert.equal(seen, 'http://127.0.0.1:11434/api/tags')
  await assert.rejects(checkOllamaModel({ fetchImpl: async () => Response.json({ models: [] }) }), /not installed/)
  await assert.rejects(checkOllamaModel({ fetchImpl: async () => { throw new Error('offline') } }), /unreachable/)
  await assert.rejects(checkOllamaModel({ ollamaUrl: 'http://example.com' }), /loopback/)
})
