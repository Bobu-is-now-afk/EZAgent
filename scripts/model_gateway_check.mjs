#!/usr/bin/env node
import { checkOllamaModel } from './model_gateway.mjs'

try {
  await checkOllamaModel({ ollamaUrl: process.env.MODEL_GATEWAY_OLLAMA_URL })
  process.stdout.write('[OK] qwen3.5:9b is available on loopback Ollama\n')
} catch (error) {
  process.stderr.write(`[WARN] ${error.message}\n`)
  process.exitCode = 1
}
