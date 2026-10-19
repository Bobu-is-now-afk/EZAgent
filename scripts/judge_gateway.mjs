#!/usr/bin/env node
import { createGateway, checkOllamaModel } from './model_gateway.mjs'

// Separate entrypoint: never exposes the general chat endpoint.
const server = createGateway({
  apiKey: process.env.MODEL_GATEWAY_API_KEY,
  ollamaUrl: process.env.MODEL_GATEWAY_OLLAMA_URL,
  syntheticOnly: true,
})
await checkOllamaModel({ ollamaUrl: process.env.MODEL_GATEWAY_OLLAMA_URL })
server.listen(8766, '127.0.0.1', () => {
  process.stdout.write('judge gateway listening on 127.0.0.1:8766\n')
})
