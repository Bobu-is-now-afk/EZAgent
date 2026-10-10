import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { localAiConfig } from '../../lib/local-ai/config'

test('runtime follows the prepared model and fails closed on blocked/remote/corrupt config', async () => {
  const cwd = process.cwd()
  const root = await mkdtemp(path.join(tmpdir(), 'ezagent-config-test-'))
  try {
    process.chdir(root)
    assert.equal((await localAiConfig()).model, 'qwen3.5:9b')
    await mkdir('.ezagent')
    await writeFile('.ezagent/config.json', JSON.stringify({ model: 'qwen3.5:4b' }))
    assert.equal((await localAiConfig()).model, 'qwen3.5:4b')
    for (const config of [{ model: 'qwen3.5:72b' }, { model: 'unknown' }, { ollama_host: 'https://remote.example' }]) {
      await writeFile('.ezagent/config.json', JSON.stringify(config))
      await assert.rejects(localAiConfig())
    }
    await writeFile('.ezagent/config.json', 'broken')
    await assert.rejects(localAiConfig())
  } finally { process.chdir(cwd) }
})
