import { test } from 'node:test'
import assert from 'node:assert/strict'
import { POST } from '../examples/judge-next/app/api/judge-demo/route.mjs'

test('adapter gates preview, bounds input, sanitizes output and handles upstream failures', async () => {
  const originalFetch = globalThis.fetch
  const names = ['VERCEL_ENV', 'JUDGE_DEMO_ENABLED', 'JUDGE_GATEWAY_URL', 'JUDGE_GATEWAY_API_KEY']
  const saved = names.map(name => process.env[name])
  const request = body => new Request('https://preview.example/api/judge-demo',
    { method: 'POST', body: JSON.stringify(body) })
  try {
    delete process.env.JUDGE_DEMO_ENABLED
    assert.equal((await POST(request({ scenario: 'design' }))).status, 503)
    process.env.JUDGE_DEMO_ENABLED = 'true'
    process.env.VERCEL_ENV = 'production'
    assert.equal((await POST(request({ scenario: 'design' }))).status, 503)
    process.env.VERCEL_ENV = 'preview'
    process.env.JUDGE_GATEWAY_URL = 'https://gateway.example/v1/synthetic'
    process.env.JUDGE_GATEWAY_API_KEY = 'test-fixture-only-not-a-credential-0000'
    assert.equal((await POST(request({ scenario: 'design', prompt: 'x' }))).status, 400)
    assert.equal((await POST(request({ scenario: 'x'.repeat(129) }))).status, 400)
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.redirect, 'error')
      return Response.json({ demoOnly: true, status: 'draft_only', source: 'live_model',
        scenario: 'design', item: 'design', currency: 'HKD', amount: 800, private: 'omit' })
    }
    const success = await POST(request({ scenario: 'design' }))
    assert.equal(success.status, 200)
    assert.equal((await success.json()).private, undefined)
    for (const status of [401, 429, 502, 503, 504]) {
      globalThis.fetch = async () => new Response('private', { status })
      const result = await POST(request({ scenario: 'design' }))
      assert.equal(result.status, status === 429 ? 429 : 503)
      assert.ok(!(await result.text()).includes('private'))
    }
    globalThis.fetch = async () => new Response('x'.repeat(1025))
    assert.equal((await POST(request({ scenario: 'design' }))).status, 503)
    globalThis.fetch = async () => { throw new Error('private') }
    assert.equal((await POST(request({ scenario: 'design' }))).status, 503)
  } finally {
    globalThis.fetch = originalFetch
    names.forEach((name, i) => saved[i] === undefined ? delete process.env[name] : process.env[name] = saved[i])
  }
})
