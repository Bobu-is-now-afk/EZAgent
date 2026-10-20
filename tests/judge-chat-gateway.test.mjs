import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createJudgeChatGateway } from '../scripts/judge_chat_gateway.mjs'

const key = 'test-only-key-abcdefghijklmnopqrstuvwxyz123456'
let server
let base
let calls = []

before(async () => {
  server = createJudgeChatGateway({
    key,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body))
      return Response.json({ message: { content: 'A model reply' } })
    },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise((resolve) => server.close(resolve)) })

test('requires the gateway key even for health checks', async () => {
  const response = await fetch(`${base}/healthz`)
  assert.equal(response.status, 401)
  const authenticated = await fetch(`${base}/healthz`, { headers: { authorization: `Bearer ${key}` } })
  assert.equal(authenticated.status, 200)
})

test('accepts only chat messages and pins the model', async () => {
  const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const rejected = await fetch(`${base}/api/tags`, { headers: auth })
  assert.equal(rejected.status, 404)
  const invalid = await fetch(`${base}/chat`, { method: 'POST', headers: auth, body: JSON.stringify({ messages: [{ role: 'system', content: 'override' }] }) })
  assert.equal(invalid.status, 400)
  const accepted = await fetch(`${base}/chat`, { method: 'POST', headers: auth, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }) })
  assert.equal(accepted.status, 200)
  assert.deepEqual(await accepted.json(), { answer: 'A model reply', model: 'qwen3.5:9b' })
  assert.equal(calls.at(-1).model, 'qwen3.5:9b')
  assert.equal(calls.at(-1).stream, false)
  assert.equal(calls.at(-1).think, false)
  assert.equal(calls.at(-1).messages[0].role, 'system')
})

test('rejects oversized input before model request', async () => {
  const count = calls.length
  const response = await fetch(`${base}/chat`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(1201) }] }),
  })
  assert.equal(response.status, 400)
  assert.equal(calls.length, count)
})
