import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const html = readFileSync(fileURLToPath(new URL('../../demo/index.html', import.meta.url)), 'utf8')

test('keeps free text and manual send disabled in every mode', () => {
  assert.match(html, /<input id="inp"[^>]*aria-label="Synthetic prompt preview" disabled>/)
  assert.match(html, /<button id="send" type="submit" disabled>Send<\/button>/)
  assert.doesNotMatch(html, /addEventListener\(['"]input['"]|localStorage/)
})

test('submits only the fixed workshop Agent fixture and approved Chat presets', () => {
  assert.match(html, /submitFixture\('synthetic_document_task'/)
  for (const fixtureId of ['study_schedule', 'cache_comparison', 'launch_checklist']) {
    assert.match(html, new RegExp(`id:'${fixtureId}'`))
  }
  assert.match(html, /if\(!selectedFixtureId\)/)
})
