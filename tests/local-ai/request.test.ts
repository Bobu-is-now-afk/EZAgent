import test from 'node:test'
import assert from 'node:assert/strict'
import { isLocalRequest } from '../../lib/local-ai/request'

test('only explicit same-origin loopback JSON requests may prepare local AI', () => {
  const request = (headers: Record<string, string>) => new Request('http://localhost:3000/api/local-ai', { headers })
  const good = { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' }
  assert.equal(isLocalRequest(request(good), true), true)
  for (const headers of [
    { ...good, origin: 'https://evil.example' },
    { ...good, host: 'evil.example', origin: 'http://evil.example' },
    { ...good, origin: '' },
    { ...good, 'content-type': 'text/plain' },
    { ...good, 'sec-fetch-site': 'cross-site' },
  ]) assert.equal(isLocalRequest(request(headers), true), false)
  assert.equal(isLocalRequest(request({ host: '127.0.0.1:3000' })), true)
})
