# Temporary judge Chat connection

## Scope and plan

The Product Web Preview sends **free-text Chat and Agent Builder text planning/runs** through its Vercel `/api/live-chat` route to an authenticated Cloudflare tunnel and the Mac mini gateway. The gateway calls Ollama `/api/chat` on loopback with the fixed `qwen3.5:9b` model. Suggested Chat answers and the separate simulated judge demo remain labelled scripted examples. Built agent definitions are stored in the visitor's browser and can be run again through the model; they are not background workers. The gateway cannot run tools, choose models, manage Ollama, or read local files.

The public Vercel site needs two server-only environment variables:

| Name | Value |
| --- | --- |
| `EZAGENT_CHAT_GATEWAY_URL` | The current Quick Tunnel HTTPS URL, with `/chat` appended. |
| `EZAGENT_CHAT_GATEWAY_KEY` | The same random secret stored in macOS Keychain for the gateway. |

Never use a `NEXT_PUBLIC_` prefix for the key. Never commit, log, paste into a ticket, or place the key in a file. No other environment variable is needed for this integration.

## Mac mini startup

1. Confirm Ollama is running locally and `ollama list` contains `qwen3.5:9b`. Keep Ollama bound to loopback.
2. Generate a 32-byte random gateway key and store it in macOS Keychain under service `EZAGENT_CHAT_GATEWAY_KEY`, account `judge-preview`. Do not display it.
3. Start the gateway on port 18765 (port 8765 is already used by another local service) with the key read directly from Keychain into its process environment: `EZAGENT_CHAT_GATEWAY_PORT=18765 EZAGENT_CHAT_GATEWAY_KEY="$(security find-generic-password -s EZAGENT_CHAT_GATEWAY_KEY -a judge-preview -w)" node scripts/judge_chat_gateway.mjs`. Run it from the repository checkout and keep the process alive.
4. Start `cloudflared tunnel --url http://127.0.0.1:18765`. Copy its generated HTTPS hostname into Vercel as `EZAGENT_CHAT_GATEWAY_URL` with `/chat`. The tunnel exposes only the authenticated gateway, not Ollama.
5. Enter the matching key into Vercel Production environment settings and redeploy the Product Web Preview. Do not set either variable on the separate simulated judge demo project.
6. Test a free-text message on the production site and verify the answer carries the **Live model** label. Test a suggested question and verify **Scripted sample**. Inspect the network response for `source: live`; never inspect or display the server-side key.

## Operational limits and failure handling

- The gateway accepts one model request at a time and at most eight accepted requests per minute; each model request times out after 45 seconds. Vercel times out after 50 seconds. Long responses are capped at 256 generated tokens.
- Cloudflare Quick Tunnel is temporary. Its hostname changes after restart or disconnection. The Mac mini must stay awake, with Ollama, gateway, and cloudflared running. On restart, update `EZAGENT_CHAT_GATEWAY_URL` and redeploy. A stale URL causes Chat to show an unavailable message; scripted samples continue to work.
- Do not enter personal or confidential information in this judge preview. Prompts pass through Vercel, Cloudflare, and the Mac mini model.
- Review this temporary arrangement by Thursday, 2026-10-22 (Hong Kong time). Replace it with a stable, managed endpoint if judges need ongoing access.

## Rollback

Stop cloudflared and the gateway. Remove `EZAGENT_CHAT_GATEWAY_URL` and `EZAGENT_CHAT_GATEWAY_KEY` from the Product Web Preview environment and redeploy. Free-text Chat will then show an unavailable status; suggested samples remain usable. Revert the integration PR to restore the previous scripted-only UI. No database migration or user data transfer is involved.
