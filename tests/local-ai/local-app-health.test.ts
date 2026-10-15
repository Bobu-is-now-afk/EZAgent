import test from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../../app/api/local-app/health/route'

test('local app health is loopback-only and requires an instance token', async () => {
  const previous = process.env.EZAGENT_APP_HEALTH_TOKEN
  process.env.EZAGENT_APP_HEALTH_TOKEN = 'synthetic-health-token'
  try {
    const local = await GET(new Request('http://127.0.0.1/api/local-app/health', { headers: { host: '127.0.0.1:3210' } }))
    assert.equal(local.status, 200)
    assert.deepEqual(await local.json(), { service: 'ezagent-local-app', instance: 'synthetic-health-token' })

    const remote = await GET(new Request('http://example.test/api/local-app/health', { headers: { host: 'example.test' } }))
    assert.equal(remote.status, 403)

    delete process.env.EZAGENT_APP_HEALTH_TOKEN
    const unavailable = await GET(new Request('http://127.0.0.1/api/local-app/health', { headers: { host: '127.0.0.1:3210' } }))
    assert.equal(unavailable.status, 503)
  } finally {
    if (previous === undefined) delete process.env.EZAGENT_APP_HEALTH_TOKEN
    else process.env.EZAGENT_APP_HEALTH_TOKEN = previous
  }
})
