# Reusable Mac mini model API for a Vercel demo

## What the judge uses

`Judge browser -> teammate website /api/model -> Vercel function -> HTTPS model gateway -> Mac mini Ollama (127.0.0.1:11434)`

Judges only open the website. The browser never receives the gateway URL or key. The gateway exposes one OpenAI-compatible `POST /v1/chat/completions` endpoint and one authenticated `GET /healthz` endpoint. It always runs `qwen3.5:9b`; it cannot download models or run tools. An agent's allowed tools and state transitions remain in the website backend.

Local Ollama has no API key. The gateway adds a separate bearer key before any external connection. Do **not** tunnel port `11434` or the whole EZAgent Next.js application. This gateway binds to `127.0.0.1:8765` by default and uses no new npm dependencies.

## Values to configure

| Location | Name | Value |
| --- | --- | --- |
| Mac mini runtime, from an existing secret manager or macOS Keychain | `MODEL_GATEWAY_API_KEY` | A unique 32–256 byte secret. Never commit or log it. |
| Mac mini runtime | `MODEL_GATEWAY_PORT` | Optional; defaults to `8765`. |
| Vercel Project → Settings → Environment Variables | `MODEL_API_URL` | Exact `https://<demo-host>/v1/chat/completions` URL. |
| Vercel Project → Settings → Environment Variables | `MODEL_API_KEY` | The same secret as `MODEL_GATEWAY_API_KEY`; mark Sensitive. |

These names can be reused across projects. One gateway process accepts one key; for independent revocation later, run a separate gateway instance/port/key for each project. Do not use a `NEXT_PUBLIC_` prefix. Do not put a real key in a file, URL, Git commit, screenshot, or chat. A `.env.example` can document names, but must not hold a value. Vercel variable changes require a new deployment to take effect.

## Mac mini preparation (local only)

1. Confirm Ollama is running and `qwen3.5:9b` is installed: `ollama list`.
2. Place the demo key in the existing secret manager or create a macOS Keychain password item with service name `EZAgentModelGateway` and account name `hackathon`. Use the same value in Vercel. The operator enters the value; this repository does not generate or save one.
3. Start the gateway from the repository with a runtime-only variable (the command does not print the key):

   ```sh
   MODEL_GATEWAY_API_KEY="$(security find-generic-password -a hackathon -s EZAgentModelGateway -w)" node scripts/model_gateway.mjs
   ```

4. Before any public routing, test the loopback gateway from another terminal. Retrieve the key from Keychain into a shell variable without printing it, then call the authenticated health endpoint:

   ```sh
   demo_key="$(security find-generic-password -a hackathon -s EZAgentModelGateway -w)"
   curl --fail-with-body --silent --show-error -H "Authorization: Bearer $demo_key" http://127.0.0.1:8765/healthz
   unset demo_key
   ```

The gateway rejects missing or short keys, wrong keys, non-loopback Ollama addresses, other models, streaming requests, oversized bodies, and requests beyond 12/minute or one active model call. It gives the model at most 45 seconds. These are demo limits, not a multi-tenant production service.

## External connection (approval gate)

The repository already has `cloudflared` available on this Mac mini. A Cloudflare Tunnel published application can map `https://<demo-host>` to `http://127.0.0.1:8765`, without opening the Ollama port. Create that hostname-to-service mapping only after owner approval, and verify the route points to the **gateway port**, not `11434` or the EZAgent web app. Keep the terminal running for the pitch or use an approved managed service configuration. Tunnel setup, DNS/publicity changes and key creation are not performed by this repository change.

Do not use a transient Quick Tunnel URL in Vercel for the pitch: a changed hostname requires a Vercel variable update and redeployment. Choose a stable HTTPS hostname for the demo.

## Teammate's Vercel backend

For a Next.js App Router website, copy:

- `examples/vercel-next/lib/model-client.js` to the website's `lib/model-client.js`.
- `examples/vercel-next/app/api/model/route.js` to its `app/api/model/route.js`.
- `examples/vercel-next/app/api/demo-agent/route.js` to its `app/api/demo-agent/route.js` only if the team wants the bounded agent demonstration. It is an invented HKD quotation draft: one model-selected catalogue item, one deterministic price calculation, and a fixed explanation. It does not create orders, files, invoices, payments or approvals. Replace the catalogue only after the business rules and data source are reviewed.

In Vercel, add `MODEL_API_URL` and Sensitive `MODEL_API_KEY` under the project's environment variables, select the intended environment, then redeploy. The frontend calls its own origin only:

```js
const response = await fetch('/api/model', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'Give me a short demo response.' }),
})
const { answer } = await response.json()
```

For the optional demo agent, the frontend calls the same website origin:

```js
const response = await fetch('/api/demo-agent', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ request: 'I need one design session.' }),
})
const { draft, explanation } = await response.json()
// Show draft.status === 'draft_only' and the explicit demoOnly label.
```

For `422 draft_not_understood`, keep the user's text and ask them to name design, print or consultation; do not create an empty quotation. This may happen if the model does not return the expected tool call. The agent still uses one model call and never executes an unknown tool.

Both website routes check browser `Origin` when present, cap request bodies, and avoid returning the gateway key. This is a **public demo endpoint**, not a user login or durable per-visitor quota. The Mac gateway provides the hard shared limit of 12 accepted model calls per minute, one active call, and a 45-second model timeout. The optional agent uses one model call; concurrent judges may get `429`. **Public website release is blocked until the owner approves and verifies a site-level access or edge rate control.** In-memory Vercel Function counters and `Origin` checks alone do not stop scripted traffic or Vercel invocation costs. The team should test the chosen control with allowed judge traffic and excess requests before publishing. Show a short “Busy, retry in a moment” message for `429` and a “Demo temporarily unavailable” message for `503`.

### Framework-neutral contract

For any other website backend, implement server-side `POST /api/model` accepting `{ "prompt": "..." }` (max 2,000 characters). Read `MODEL_API_URL` and `MODEL_API_KEY` **only in server runtime**, then send `POST` to the exact HTTPS `MODEL_API_URL` with `Authorization: Bearer <MODEL_API_KEY>` and JSON `{ "model": "qwen3.5:9b", "messages": [{ "role": "user", "content": prompt }], "stream": false, "max_tokens": 512 }`. Return only `{ "answer": "..." }` to the browser, without forwarding upstream headers or errors. Set a 50-second timeout and no-store caching. The browser calls its own `/api/model`, never the Mac hostname. The agent variant keeps the tool catalogue and state machine on the website backend, accepts only validated model tool arguments, and caps itself at one model call.

If the website already has an agent backend, import `callModel` there. It accepts `messages`, `tools`, and `tool_choice` and returns the model's OpenAI-compatible response. The backend must validate tool calls, execute only its approved tools, cap agent steps, and send tool results back in a subsequent `callModel` request. Replacing the model URL alone will not repair broken orchestration or tool permissions. If the site is static HTML, it still needs a Vercel Function or other server-side endpoint to keep the key out of browser code.

## Verification before the pitch

1. Run `node --test tests/model-gateway.test.mjs` and the repository's normal check.
2. Verify a request without a key gets `401`, valid `/healthz` gets `200`, and a valid chat gets one response from `qwen3.5:9b`.
3. From the deployed website, submit one synthetic prompt and confirm a response without exposing the key in browser DevTools. Confirm `MODEL_API_KEY` never appears in a `NEXT_PUBLIC_` variable or frontend bundle.
4. Test several simultaneous judges; expect `429 model_busy` when the single Mac mini model is occupied. The website should show a retry message. Measure actual response time before the pitch.
5. Stop the gateway and verify the website shows a graceful unavailable state. Restart it and retest. Keep a prepared non-live demo clip or screenshots for network failure.

## Stop and rollback

Stop the gateway process and disable the Tunnel route to terminate access. Remove or rotate `MODEL_API_KEY` in Vercel and redeploy. Revert this branch/PR to remove the code. No data migration is involved. The key is never stored in this repository.

References: [Ollama local API and authentication](https://docs.ollama.com/api/introduction), [Cloudflare Tunnel published routing](https://developers.cloudflare.com/tunnel/concepts/routing/), [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables), [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).
