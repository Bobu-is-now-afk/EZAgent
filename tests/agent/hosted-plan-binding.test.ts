import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidHostedPlanSourceBinding, matchesHostedPlanSourceBinding, type HostedPlanSourceBinding } from '../../lib/agent/hosted-plan-binding'

const original: HostedPlanSourceBinding = {
  jobId: '4a1d3e5f-0000-4000-8000-000000000001',
  planVersion: 1,
  sourceNameSha256: 'c'.repeat(64),
  sourceType: 'csv',
  sourceSha256: 'a'.repeat(64),
}

test('a restored hosted plan only matches the same filename hash, format, and source digest', () => {
  assert.equal(matchesHostedPlanSourceBinding(original, { nameSha256: 'c'.repeat(64), type: 'csv', sha256: original.sourceSha256 }), true)
  assert.equal(matchesHostedPlanSourceBinding(original, { nameSha256: 'c'.repeat(64), type: 'csv', sha256: 'b'.repeat(64) }), false)
  assert.equal(matchesHostedPlanSourceBinding(original, { nameSha256: 'd'.repeat(64), type: 'csv', sha256: original.sourceSha256 }), false)
  assert.equal(matchesHostedPlanSourceBinding(original, { nameSha256: 'c'.repeat(64), type: 'text', sha256: original.sourceSha256 }), false)
  assert.equal(matchesHostedPlanSourceBinding(original, null), false)
  assert.equal(matchesHostedPlanSourceBinding(null, { nameSha256: 'c'.repeat(64), type: 'csv', sha256: original.sourceSha256 }), false)
  assert.equal(isValidHostedPlanSourceBinding(original), true)
  assert.equal(isValidHostedPlanSourceBinding({ ...original, sourceSha256: 'invalid' }), false)
})
