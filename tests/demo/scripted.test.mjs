import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as chat from '../../demo/api/chat.mjs'
import * as agent from '../../demo/api/agent-suggest.mjs'
import * as document from '../../demo/api/document-suggest.mjs'
import * as status from '../../demo/api/status.mjs'

test('former provider routes never invoke a provider even when a key exists', async () => {
  const priorKey = process.env.GEMINI_API_KEY
  const priorFetch = globalThis.fetch
  let calls = 0
  process.env.GEMINI_API_KEY = 'test-only-key'
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected network request') }
  try {
    for (const route of [chat, agent, document]) {
      for (const method of ['GET', 'POST']) {
        const response = await route[method](new Request('https://example.invalid/api', { method }))
        assert.equal(response.status, 410)
        assert.deepEqual(await response.json(), { status: 'error', error: 'scripted_demo_only' })
      }
    }
    const result = await status.GET()
    assert.deepEqual(await result.json(), { configured: false, mode: 'scripted_demo', connectivity: 'not_applicable' })
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = priorFetch
    if (priorKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = priorKey
  }
})

test('visible demo scripts use fixed responses and never request model endpoints', async () => {
  const home = await readFile(new URL('../../demo/index.html', import.meta.url), 'utf8')
  const studio = await readFile(new URL('../../demo/documents.js', import.meta.url), 'utf8')
  assert.match(home, /This demo website simulates the process/)
  assert.match(home, /href="https:\/\/ezagent-product-web-preview\.vercel\.app\/"/)
  assert.match(home, /<div id="app" hidden>[\s\S]*class="app-product-link" href="https:\/\/ezagent-product-web-preview\.vercel\.app\/"/)
  assert.match(home, /This simulated walkthrough itself never contacts the model/)
  assert.match(home, /Pre-scripted reply · fictional example/)
  assert.match(studio, /description: 'workshop days', quantity: 2/)
  assert.doesNotMatch(home, /fetch\(/)
  assert.doesNotMatch(studio, /fetch\(/)
})
