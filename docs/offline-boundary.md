# Local execution boundary

This document records the verified boundary for the current Next.js development demo. It is not a claim of regulatory compliance or a packaged zero-setup product.

## Observed implementation

- Browser requests in `components/agent/agent-workspace.tsx` target same-origin `/api/chat` and `/api/agent/...` routes. The Run event stream also uses a same-origin URL.
- The server chat route and Planner target `http://127.0.0.1:11434` for Ollama. Imported invoice data and Run artifacts are kept under ignored `.ezagent/` on the local machine.
- `app/layout.tsx` does not render Vercel Analytics. The dependency remains in `package.json` but is not imported by the runtime UI. CSS imports resolve from installed packages. No remote fonts are used. Setup links to official Ollama download pages; model downloads require network access.
- Local HTTP and browser tests have verified the invoice demo while the development server and Ollama were running on loopback.

## Not yet established

- A disconnected-network run has not been completed. The current evidence supports local request routing, not a blanket “100% offline” claim for all framework or operating-system behavior.
- No Tauri installer, packaged local model, automatic dependency setup, or production deployment has been delivered. An installer still needs to prepare Node dependencies, Python 3 and start the app. Once open, the UI checks/starts Ollama and downloads an allowlisted model; missing Ollama opens an official installer link. Linux engine installation still needs assistance.
- No PDPO compliance assessment has been performed. The demo uses synthetic invoices and does not require real customer, medical, insurance, or financial records.
- The local Run store coordinates one Node process. It has no multi-process filesystem lock and must not be shared by multiple independent server processes.

For a demo, describe the result as “local Ollama inference and local invoice processing in the development build.” Do not describe the current prototype as a packaged, zero-setup, general-purpose agent platform.

## 2026-10-10 Yolanda integration verification

The production build on macOS completed a real Qwen 3.5 9B invoice plan/run from the bundled
synthetic sample, displaying four output rows and one missing-customer flag. The browser
download event returned a CSV file. Network disconnection was not tested. Runtime AI requests
remain loopback-only; setup checks are read-only and preparation requires explicit UI action.
