import { NextResponse } from 'next/server'

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const MODEL_NAME = 'qwen3.5:9b'
const MAX_MESSAGES = 40
const MAX_MESSAGE_LENGTH = 20_000

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function POST(request: Request) {
  let parsedBody: unknown

  try {
    parsedBody = await request.json()
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body must be valid JSON.')
  }

  if (!parsedBody || typeof parsedBody !== 'object') {
    return errorResponse(400, 'invalid_messages', 'Request body must contain a messages array.')
  }

  const body = parsedBody as { messages?: unknown }
  const input = body.messages
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    return errorResponse(400, 'invalid_messages', `Provide between 1 and ${MAX_MESSAGES} chat messages.`)
  }

  const messages: ChatMessage[] = []
  for (const message of input) {
    if (
      !message ||
      typeof message !== 'object' ||
      !('role' in message) ||
      !('content' in message) ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      !message.content.trim() ||
      message.content.length > MAX_MESSAGE_LENGTH
    ) {
      return errorResponse(400, 'invalid_messages', 'Each message must have a user or assistant role and non-empty text under 20,000 characters.')
    }

    messages.push({ role: message.role, content: message.content })
  }

  try {
    const modelsResponse = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      cache: 'no-store',
      signal: request.signal,
    })

    if (!modelsResponse.ok) {
      return errorResponse(502, 'ollama_unavailable', 'Ollama responded, but its local model list could not be read.')
    }

    const models = await modelsResponse.json()
    const installedModels: unknown[] = Array.isArray(models?.models) ? models.models : []
    const modelIsInstalled = installedModels.some((model) => {
      return (
        model &&
        typeof model === 'object' &&
        'name' in model &&
        typeof model.name === 'string' &&
        model.name === MODEL_NAME
      )
    })

    if (!modelIsInstalled) {
      return errorResponse(409, 'model_missing', `The required local model ${MODEL_NAME} is not installed.`)
    }

    const chatResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL_NAME, messages, stream: true }),
      cache: 'no-store',
      signal: request.signal,
    })

    if (!chatResponse.ok) {
      const detail = await chatResponse.text()
      if (chatResponse.status === 404 && /model.+not found/i.test(detail)) {
        return errorResponse(409, 'model_missing', `The required local model ${MODEL_NAME} is not installed.`)
      }
      return errorResponse(502, 'ollama_request_failed', 'Ollama could not complete the chat request.')
    }

    if (!chatResponse.body) {
      return errorResponse(502, 'empty_stream', 'Ollama returned an empty response stream.')
    }

    return new Response(chatResponse.body, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      },
    })
  } catch (error) {
    if (request.signal.aborted) {
      return errorResponse(499, 'request_cancelled', 'The chat request was cancelled.')
    }
    if (error instanceof TypeError) {
      return errorResponse(503, 'ollama_unreachable', 'Could not reach the local Ollama service at 127.0.0.1:11434.')
    }
    return errorResponse(502, 'ollama_error', 'Ollama returned an unreadable response.')
  }
}
