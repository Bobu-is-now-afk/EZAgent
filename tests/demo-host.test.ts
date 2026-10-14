import assert from 'node:assert/strict'
import test from 'node:test'
import { isHostedDemoHostname, isLocalHostname } from '../lib/demo-host'

test('local host detection excludes IPv4/IPv6 loopback and localhost aliases', () => {
  for (const hostname of ['localhost', 'localhost.', 'review.localhost', '127.0.0.1', '127.0.0.2', '0.0.0.0', '::1', '[::1]']) {
    assert.equal(isLocalHostname(hostname), true, hostname)
    assert.equal(isHostedDemoHostname(hostname), false, hostname)
  }
})

test('public hostnames use hosted demo UX', () => {
  for (const hostname of ['ezagent.example.com', 'demo.example.test', '10.0.0.24']) {
    assert.equal(isLocalHostname(hostname), false, hostname)
    assert.equal(isHostedDemoHostname(hostname), true, hostname)
  }
})
