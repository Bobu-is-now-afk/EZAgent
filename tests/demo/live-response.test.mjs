import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAgentResponse, parseChatResponse } from '../../demo/live-response.mjs'

const envelope = { status: 'live', source: 'gemini', model: 'gemini-2.5-flash' }

test('parses the Gemini chat answer field', () => {
  const parsed = parseChatResponse({ ...envelope, answer: '  A concise answer.  ' })
  assert.deepEqual(parsed, { model: envelope.model, text: 'A concise answer.' })
})

test('rejects legacy reply field instead of showing an empty live response', () => {
  assert.throws(() => parseChatResponse({ ...envelope, reply: 'not the API contract' }), /no answer/i)
})

test('formats the agent roles, proposed steps, and missing fields from the Gemini contract', () => {
  const parsed = parseAgentResponse({
    ...envelope,
    roles: [
      { id: 'gm', label: 'GM', responsibility: 'Coordinates a proposal.' },
      { id: 'research_manager', label: 'Research manager', responsibility: 'Finds missing inputs.' },
      { id: 'delivery_manager', label: 'Delivery manager', responsibility: 'Orders draft steps.' },
      { id: 'analysis_worker', label: 'Analysis worker', responsibility: 'Drafts analysis.' },
      { id: 'document_worker', label: 'Document worker', responsibility: 'Drafts document fields.' },
    ],
    proposedSteps: ['Review synthetic input', 'Prepare a draft'],
    missing: ['buyer'],
  })
  assert.equal(parsed.model, envelope.model)
  assert.match(parsed.text, /Proposed roles/)
  assert.match(parsed.text, /Research manager/)
  assert.match(parsed.text, /Proposed steps[\s\S]*Review synthetic input/)
  assert.match(parsed.text, /Missing information for human review[\s\S]*buyer/)
})

test('rejects a configured status as proof of a live reply', () => {
  assert.throws(() => parseChatResponse({ configured: true, connectivity: 'not_checked', answer: 'sample' }), /did not confirm a live result/i)
})

test('rejects a live agent response whose role IDs differ from the fixed server role set', () => {
  assert.throws(() => parseAgentResponse({
    ...envelope,
    roles: [],
    proposedSteps: [],
    missing: [],
  }), /invalid proposed role list/i)
})
