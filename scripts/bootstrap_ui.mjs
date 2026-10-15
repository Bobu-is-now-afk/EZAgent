#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statfsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDir, '..')
const defaultHost = 'http://127.0.0.1:11434'

function emitEvent(emit, event) { emit(`${JSON.stringify(event)}\n`) }

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw new Error('config_error')
  }
}

function findOllama() {
  const candidates = [
    ...String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, 'ollama')),
    '/Applications/Ollama.app/Contents/Resources/ollama', '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama',
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function installedModels(host) {
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3_000) })
    if (!response.ok) return null
    const body = await response.json()
    if (!Array.isArray(body.models)) return null
    return new Set(body.models.flatMap((item) => typeof item?.name === 'string' ? [item.name] : []))
  } catch { return null }
}

function freeDiskGb(directory) {
  let target = directory
  while (!existsSync(target) && target !== path.dirname(target)) target = path.dirname(target)
  try {
    const info = statfsSync(target)
    return (info.bavail * info.bsize) / (1024 ** 3)
  } catch { return null }
}

function totalRamGb() { return os.totalmem() / (1024 ** 3) }

export async function inspect({ root = appRoot, host = defaultHost, requested, ramGb = totalRamGb(), diskGb, models } = {}) {
  const manifest = readJson(path.join(root, 'models.manifest.json'), null)
  if (!manifest || !Array.isArray(manifest.models)) throw new Error('manifest_unavailable')
  const configPath = path.join(root, '.ezagent', 'config.json')
  const current = readJson(configPath, {})
  if (current.ollama_host && current.ollama_host !== host) throw new Error('config_error')
  const modelDirectory = process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models')
  const freeGb = diskGb ?? freeDiskGb(modelDirectory)
  const installed = models ?? await installedModels(host)
  const choices = manifest.models.map((model) => {
    let reason = null
    if (model.blocked) reason = 'blocked'
    else if (!Number.isFinite(ramGb) || freeGb === null) reason = 'hardware_unknown'
    else if (ramGb + 0.5 < model.min_ram_gb) reason = 'memory'
    else if (!installed?.has(model.id) && freeGb < model.min_disk_gb) reason = 'disk'
    return { ...model, available: reason === null, reason }
  })
  const safe = choices.filter((model) => model.available && model.tier !== 'high_tier')
  let preferred = safe.find((model) => model.id === manifest.default_model_id) ?? safe[0]
  const selectedId = requested ?? current.model
  let model = choices.find((candidate) => candidate.id === selectedId) ?? (selectedId ? null : preferred)
  if (!requested && selectedId && (!model || !model.available)) model = preferred
  if (!model || !model.available) return { state: 'hardware_blocked', model: model?.id ?? null, models: choices, ram_gb: ramGb, disk_gb: freeGb, host, os: process.platform === 'darwin' ? 'macos' : process.platform }
  const ollama = findOllama()
  let state
  if (installed === null) state = ollama || existsSync('/Applications/Ollama.app') ? 'engine_stopped' : 'install_required'
  else if (!installed.has(model.id)) state = 'model_missing'
  else if (model.id !== (current.model ?? manifest.default_model_id)) state = 'selection_required'
  else state = 'ready'
  return { state, model: model.id, models: choices, ram_gb: ramGb, disk_gb: freeGb, host, os: process.platform === 'darwin' ? 'macos' : process.platform }
}

function startOllama() {
  const ollama = findOllama()
  if (!ollama) return false
  if (existsSync('/Applications/Ollama.app')) {
    const opened = spawnSync('/usr/bin/open', ['-a', 'Ollama'], { stdio: 'ignore' })
    if (opened.error || opened.status !== 0) return false
  } else {
    const child = spawn(ollama, ['serve'], { detached: true, stdio: 'ignore' })
    child.unref()
  }
  return true
}

async function waitForEngine(host, milliseconds = 60_000) {
  const end = Date.now() + milliseconds
  while (Date.now() < end) {
    if (await installedModels(host) !== null) return true
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
  return false
}

async function pullModel(host, model, emit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30 * 60_000)
  try {
    const response = await fetch(`${host}/api/pull`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }), signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error('download_failed')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    let lastPercent = -1
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line)
        if (event.error) throw new Error('download_failed')
        if (event.total > 0) {
          const percent = Math.min(100, Math.max(0, Math.floor(event.completed * 100 / event.total)))
          if (percent !== lastPercent) { emitEvent(emit, { state: 'downloading', percent }); lastPercent = percent }
        }
      }
      if (done) break
    }
    if (pending.trim()) {
      const event = JSON.parse(pending)
      if (event.error) throw new Error('download_failed')
    }
  } finally { clearTimeout(timer) }
}

export function saveConfig(root, model, host) {
  const directory = path.join(root, '.ezagent')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const configPath = path.join(directory, 'config.json')
  const existing = readJson(configPath, {})
  if (existing.ollama_host && existing.ollama_host !== defaultHost) throw new Error('config_error')
  const next = { ...existing, schema_version: 1, model, ollama_host: host, os: process.platform === 'darwin' ? 'macos' : process.platform, source: 'scripts/bootstrap_ui.mjs' }
  const temporary = path.join(directory, `config.${randomUUID()}.tmp`)
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  renameSync(temporary, configPath)
}

export async function run({ args = process.argv.slice(2), root = appRoot, emit = (chunk) => process.stdout.write(chunk) } = {}) {
  const checkOnly = args.includes('--check-only')
  const modelIndex = args.indexOf('--model')
  const requested = modelIndex >= 0 ? args[modelIndex + 1] : undefined
  const yes = args.includes('--yes')
  const host = defaultHost
  try {
    let status = await inspect({ root, host, requested })
    if (checkOnly) { emitEvent(emit, status); return status.state === 'ready' ? 0 : 0 }
    if (!yes) { emitEvent(emit, { state: 'consent_required' }); return 1 }
    if (status.state === 'hardware_blocked') { emitEvent(emit, status); return 1 }
    if (status.state === 'install_required') { emitEvent(emit, status); return 1 }
    if (status.state === 'engine_stopped') {
      emitEvent(emit, { state: 'starting' })
      if (!startOllama() || !(await waitForEngine(host))) throw new Error('engine_start_failed')
    }
    const installed = await installedModels(host)
    if (!installed) throw new Error('engine_unavailable')
    if (!installed.has(status.model)) {
      emitEvent(emit, { state: 'downloading' })
      await pullModel(host, status.model, emit)
    }
    const verified = await installedModels(host)
    if (!verified?.has(status.model)) throw new Error('verification_failed')
    saveConfig(root, status.model, host)
    status = await inspect({ root, host, requested: status.model, models: verified })
    emitEvent(emit, status)
    return status.state === 'ready' ? 0 : 1
  } catch (error) {
    const code = error?.message === 'config_error' ? 'config_error' : 'failed'
    emitEvent(emit, { state: code })
    return 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await run()
