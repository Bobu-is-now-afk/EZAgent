# Local execution boundary

This document records the verified boundary for the current Next.js development demo. It is not a claim of regulatory compliance or a packaged zero-setup product.

## Observed implementation

- Browser requests in `app/page.tsx` target same-origin `/api/chat` and `/api/agent/...` routes. The Run event stream also uses a same-origin URL.
- The server chat route and Planner target `http://127.0.0.1:11434` for Ollama. Imported invoice data and Run artifacts are kept under ignored `.ezagent/` on the local machine.
- `app/layout.tsx` does not render Vercel Analytics. The dependency remains in `package.json` but is not imported by the runtime UI. CSS imports resolve from installed packages. No remote font or external application URL appears in the application source checked for this demo.
- Local HTTP and browser tests have verified the invoice demo while the development server and Ollama were running on loopback.

## Not yet established

- A disconnected-network run has not been completed. The current evidence supports local request routing, not a blanket “100% offline” claim for all framework or operating-system behavior.
- No Tauri installer, packaged local model, automatic dependency setup, or production deployment has been delivered. A user currently needs Node dependencies and an installed Ollama model.
- No PDPO compliance assessment has been performed. The demo uses synthetic invoices and does not require real customer, medical, insurance, or financial records.
- The local Run store coordinates one Node process. It has no multi-process filesystem lock and must not be shared by multiple independent server processes.

For a demo, describe the result as “local Ollama inference and local invoice processing in the development build.” Do not describe the current prototype as a packaged, zero-setup, general-purpose agent platform.
