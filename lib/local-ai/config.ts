import { readFile } from 'node:fs/promises'
import path from 'node:path'
import manifest from '../../models.manifest.json'

export async function localAiConfig() {
  let config: { model?: string; ollama_host?: string } = {}
  try {
    config = JSON.parse(await readFile(path.join(process.cwd(), '.ezagent/config.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('local_ai_config_invalid')
  }
  const model = config.model ?? manifest.default_model_id
  if (!manifest.models.some((entry) => entry.id === model && !entry.blocked)) throw new Error('local_ai_model_blocked')
  if (config.ollama_host && config.ollama_host !== manifest.ollama_host_default) throw new Error('local_ai_host_not_local')
  return { model, host: manifest.ollama_host_default }
}
