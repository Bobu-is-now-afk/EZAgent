import assert from 'node:assert/strict'
import test from 'node:test'

import { agentSuggest, chat, DemoError, documentSuggest, FIXTURES, LIMITS, parseRequest } from '../../demo/lib/gemini.mjs'
import { readJson } from '../../demo/lib/http.mjs'

const provider = (value, status = 200) => async (_url, init) => {
  const request = JSON.parse(init.body)
  assert.equal(request.generationConfig.maxOutputTokens, LIMITS.outputTokens)
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }, { status })
}

test('chat accepts only server-owned fixture IDs and calls the allowlisted Gemini model', async () => {
  let sentUrl = ''
  let sentKey = ''
  const result = await chat({ fixtureId: 'study_schedule' }, {
    apiKey: 'test-only-key',
    fetcher: async (url, init) => {
      sentUrl = String(url)
      sentKey = new Headers(init.headers).get('x-goog-api-key')
      return provider({ answer: 'A short study plan.' })(url, init)
    },
  })
  assert.deepEqual(result, { status: 'live', source: 'gemini', model: 'gemini-2.5-flash', answer: 'A short study plan.' })
  assert.match(sentUrl, /models\/gemini-2\.5-flash:generateContent$/)
  assert.equal(sentKey, 'test-only-key')
  assert.throws(() => parseRequest({ fixtureId: 'study_schedule', text: 'private data' }, ['fixtureId'], FIXTURES.chat), DemoError)
  assert.throws(() => parseRequest({ fixtureId: 'unknown' }, ['fixtureId'], FIXTURES.chat), DemoError)
})

test('agent response uses server-fixed roles and bounds suggested steps', async () => {
  const result = await agentSuggest({ fixtureId: 'synthetic_document_task', template: 'documents' }, {
    apiKey: 'test-only-key', fetcher: provider({ proposedSteps: ['Clarify', 'Review', 'Ask', 'Extra'], missing: ['Owner?', 'Input?', 'Date?', 'Extra?'] }),
  })
  assert.equal(result.status, 'live')
  assert.equal(result.roles.map((role) => role.id).join(','), 'gm,research_manager,delivery_manager,analysis_worker,document_worker')
  assert.equal(result.proposedSteps.length, 4)
  assert.equal(result.missing.length, 4)
  assert.throws(() => parseRequest({ fixtureId: 'synthetic_document_task', template: 'execute' }, ['fixtureId', 'template'], [FIXTURES.agent]), DemoError)
})

test('document response returns only explicit allowed fields, never amount', async () => {
  let prompt = ''
  const result = await documentSuggest({ fixtureId: 'workshop_quote' }, {
    apiKey: 'test-only-key', fetcher: async (_url, init) => {
      const body = JSON.parse(init.body)
      prompt = body.contents[0].parts[0].text
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ buyer: 'Invented Buyer Ltd', description: 'Workshop Days', quantity: 2, missing: [] }) }] } }] })
    },
  })
  assert.match(prompt, /Synthetic source: Create a quote for two workshop days next month\./)
  assert.deepEqual(result.suggestion, { buyer: null, description: 'workshop days', quantity: 2, missing: ['buyer'] })
  assert.equal('amount' in result.suggestion, false)
  await assert.rejects(documentSuggest({ fixtureId: 'workshop_quote', text: 'arbitrary content' }, { apiKey: 'test-only-key', fetcher: provider({}) }), (error) => error instanceof DemoError && error.code === 'invalid_input')
  await assert.rejects(documentSuggest({ fixtureId: 'workshop_quote' }, { apiKey: 'test-only-key', fetcher: provider({ buyer: 'x', description: 'y', quantity: 1, missing: [], amount: 20 }) }), (error) => error instanceof DemoError && error.code === 'invalid_provider_response')
})

test('document response drops invented fixture values and non-integer quantities', async () => {
  for (const quantity of [5, 4.5]) {
    const result = await documentSuggest({ fixtureId: 'workshop_quote' }, {
      apiKey: 'test-only-key',
      fetcher: provider({ buyer: 'Invented Buyer Ltd', description: 'Invented service', quantity, missing: [] }),
    })
    assert.deepEqual(result.suggestion, { buyer: null, description: null, quantity: null, missing: ['buyer', 'description', 'quantity'] })
  }
})

test('missing key and Gemini failures return explicit sanitized errors', async () => {
  await assert.rejects(chat({ fixtureId: 'launch_checklist' }, { fetcher: provider({ answer: 'no' }) }), (error) => error instanceof DemoError && error.code === 'not_configured' && error.status === 503)
  await assert.rejects(chat({ fixtureId: 'launch_checklist' }, { apiKey: 'test-only-key', fetcher: provider({}, 500) }), (error) => error instanceof DemoError && error.code === 'provider_unavailable')
  await assert.rejects(chat({ fixtureId: 'launch_checklist' }, { apiKey: 'test-only-key', fetcher: async () => { throw new Error('network detail') } }), (error) => error instanceof DemoError && error.code === 'provider_unavailable' && !error.message.includes('network detail'))
  await assert.rejects(chat({ fixtureId: 'launch_checklist' }, { apiKey: 'test-only-key', fetcher: async () => new Response('not json', { status: 200 }) }), (error) => error instanceof DemoError && error.code === 'invalid_provider_response')
})

test('provider timeout is explicit and does not retry', async () => {
  let calls = 0
  const fetcher = (_url, init) => {
    calls += 1
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  }
  await assert.rejects(chat({ fixtureId: 'study_schedule' }, { apiKey: 'test-only-key', fetcher, timeoutMs: 5 }), (error) => error instanceof DemoError && error.code === 'provider_timeout' && error.status === 504)
  assert.equal(calls, 1)
})

test('request parser enforces byte and UTF-8 bounds', async () => {
  const large = new Request('https://demo.invalid/api/chat', { method: 'POST', body: ' '.repeat(LIMITS.bodyBytes + 1) })
  await assert.rejects(readJson(large), (error) => error instanceof DemoError && error.code === 'request_too_large')
  const malformed = new Request('https://demo.invalid/api/chat', { method: 'POST', body: new Uint8Array([0xff]) })
  await assert.rejects(readJson(malformed), (error) => error instanceof DemoError && error.code === 'invalid_input')
})
