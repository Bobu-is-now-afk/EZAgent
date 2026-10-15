import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { inspect, run, saveConfig } from '../../scripts/bootstrap_ui.mjs'

async function sandbox(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ezagent-bootstrap-ui-test-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'models.manifest.json'), JSON.stringify({
    default_model_id: 'qwen3.5:9b',
    ollama_host_default: 'http://127.0.0.1:11434',
    models: [
      { id: 'qwen3.5:9b', min_ram_gb: 16, min_disk_gb: 8, tier: 'default', blocked: false },
      { id: 'qwen3.5:72b', min_ram_gb: 96, min_disk_gb: 48, tier: 'high_tier', blocked: true },
    ],
  }))
  return root
}

test('Node local-AI bootstrap uses only the loopback Ollama endpoint and preserves local configuration', async (t) => {
  const root = await sandbox(t)

  const ready = await inspect({ root, ramGb: 32, diskGb: 100, models: new Set(['qwen3.5:9b']) })
  assert.equal(ready.state, 'ready')
  assert.equal(ready.host, 'http://127.0.0.1:11434')

  const blocked = await inspect({ root, requested: 'qwen3.5:72b', ramGb: 128, diskGb: 100, models: new Set() })
  assert.equal(blocked.state, 'hardware_blocked')

  await saveConfig(root, 'qwen3.5:9b', ready.host)
  const config = JSON.parse(await readFile(path.join(root, '.ezagent/config.json'), 'utf8'))
  assert.equal(config.model, 'qwen3.5:9b')
  assert.equal(config.ollama_host, 'http://127.0.0.1:11434')
})

test('check-only does not pull a model, and prepare without explicit consent is refused', async (t) => {
  const root = await sandbox(t)
  const originalFetch = globalThis.fetch
  let pullCalls = 0
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/pull')) pullCalls++
    return Response.json({ models: [] })
  }
  try {
    const checkEvents = []
    assert.equal(await run({ root, args: ['--check-only'], emit: (line) => checkEvents.push(JSON.parse(line)) }), 0)
    assert.equal(checkEvents.at(-1).state, 'model_missing')
    assert.equal(pullCalls, 0)

    const prepareEvents = []
    assert.equal(await run({ root, args: ['--model', 'qwen3.5:9b'], emit: (line) => prepareEvents.push(JSON.parse(line)) }), 1)
    assert.deepEqual(prepareEvents.at(-1), { state: 'consent_required' })
    assert.equal(pullCalls, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('an interrupted explicit model download leaves config untouched and can be retried', async (t) => {
  const root = await sandbox(t)
  const originalFetch = globalThis.fetch
  let pullCalls = 0
  let installed = false
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/api/tags')) return Response.json({ models: installed ? [{ name: 'qwen3.5:9b' }] : [] })
    if (url.endsWith('/api/pull')) {
      pullCalls++
      if (pullCalls === 1) return new Response('{"error":"synthetic interrupted stream"}\n')
      installed = true
      return new Response('{"total":100,"completed":100}\n')
    }
    throw new Error('unexpected network target')
  }
  try {
    const failedEvents = []
    assert.equal(await run({ root, args: ['--yes', '--model', 'qwen3.5:9b'], emit: (line) => failedEvents.push(JSON.parse(line)) }), 1)
    assert.equal(failedEvents.at(-1).state, 'failed')
    await assert.rejects(readFile(path.join(root, '.ezagent/config.json'), 'utf8'))

    const retryEvents = []
    assert.equal(await run({ root, args: ['--yes', '--model', 'qwen3.5:9b'], emit: (line) => retryEvents.push(JSON.parse(line)) }), 0)
    assert.equal(retryEvents.at(-1).state, 'ready')
    assert.equal(pullCalls, 2)
    const config = JSON.parse(await readFile(path.join(root, '.ezagent/config.json'), 'utf8'))
    assert.equal(config.ollama_host, 'http://127.0.0.1:11434')
  } finally { globalThis.fetch = originalFetch }
})

test('RAM, disk, malformed manifest, and malformed config fail closed', async (t) => {
  const root = await sandbox(t)
  const blocked = await inspect({ root, requested: 'qwen3.5:9b', ramGb: 2, diskGb: 2, models: new Set() })
  assert.equal(blocked.state, 'hardware_blocked')

  await saveConfig(root, 'qwen3.5:9b', 'http://127.0.0.1:11434')
  await writeFile(path.join(root, '.ezagent', 'config.json'), '{broken')
  await assert.rejects(inspect({ root, ramGb: 32, diskGb: 100, models: new Set() }), /config_error/)
  await writeFile(path.join(root, 'models.manifest.json'), '{broken')
  await assert.rejects(inspect({ root, ramGb: 32, diskGb: 100, models: new Set() }), /config_error/)
})
