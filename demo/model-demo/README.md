# EZAgent model demo

This folder is a self-contained, dependency-free local demo for `qwen3.5:9b` on the Mac mini. It also carries a copyable Next.js backend example for a teammate's website.

## Run locally

1. Install Node.js 20+ and Ollama. In Ollama, install `qwen3.5:9b` once.
2. From **this folder**, run `npm run dev`.
3. Open `http://127.0.0.1:3007` on this Mac (or screen-share it).

The local page and API bind only to loopback. No API key, npm install, tunnel, Vercel account or internet is needed for this local demo after the model is installed. `npm run dev` checks Ollama and the model before listening; it prints a clear error if either is missing. Press Ctrl+C to stop.

## Teammate's hosted website

Copy the contents of `teammate-next/` into the matching paths of a Next.js App Router project. Keep `MODEL_API_URL` and `MODEL_API_KEY` **server-side in Vercel Environment Variables**. The browser should call its own `/api/model` or `/api/demo-agent`. The hosted backend code requires the separate HTTPS gateway; this local page deliberately calls loopback Ollama directly.

The included `gateway.mjs` is a standalone copy of the authenticated gateway. To start it separately, retrieve `MODEL_GATEWAY_API_KEY` from an existing secret manager or macOS Keychain into the runtime environment, then run `npm run gateway`. Never store a real key in this folder.

For a later hosted demo, set `MODEL_API_URL` in Vercel to the exact `https://<approved-host>/v1/chat/completions` URL and set Sensitive `MODEL_API_KEY` to the same value as `MODEL_GATEWAY_API_KEY`. Publish an approved HTTPS tunnel **to `127.0.0.1:8765` only**, never directly to Ollama port `11434`. Redeploy after changing Vercel variables. Public release needs owner approval and a verified site-level access or edge rate control; the gateway's 12 calls/minute limit only protects model load. Disable the tunnel and stop the gateway to revoke access. `../../docs/model-gateway-setup.md` in the source repository has the longer runbook.

The agent uses only invented HKD prices and returns a **draft**. It does not create orders, files, invoices, payments or approvals. This folder contains no customer data or credentials.
