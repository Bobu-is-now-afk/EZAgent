# EZAgent hackathon web prototype

One folder, Node.js 20+, no npm dependencies. This is a **demonstration of the proposed product journey**, not a release build.

## Start

From this folder, run `npm run dev`, then open `http://127.0.0.1:3011`.

To enable the two live AI actions, set `GEMINI_API_KEY` in the **server process environment** using an existing secret manager, then run `npm run dev`. `GEMINI_MODEL` may be set to a model available to that API project; the default is `gemini-2.5-flash`. Never put a real key in this folder, a frontend file, a URL, a screenshot, or a commit. The site starts without a key; AI actions then show a configuration message instead of fabricated output.

## What the audience can do

| Path | Behavior | Label shown in UI |
| --- | --- | --- |
| Device check and model download | Assumed Mac mini M6/32 GB, staged animation; no hardware detection or download | Simulation |
| AI chat | Real server-side Gemini API call when configured | Gemini cloud API |
| Quotation/invoice/receipt workbench | Gemini suggests buyer, description and quantity; user applies the suggestion; fixed JavaScript calculates HKD total | Gemini suggestion + deterministic demo calculation |
| Workflow designer | Select template, missing-field rule and approval illustration; inspect agent structure | Configuration simulation, not deployed |

The document is a generic InkVoice-inspired paper layout with **synthetic data only**. The suggestion route whitelists fields and never fills price, tax, bank account or payment status. Receipt review remains blocked because payment proof is not implemented. No page issues a real invoice, stores customer data, sends messages, installs a model, or enforces manager identity.

## Presenting it honestly

Suggested introduction: “This interactive website demonstrates the intended EZAgent journey. Gemini powers the two AI steps today. The device installation and workflow deployment screens are marked simulations; the local Qwen prototype is a separate build.”

Record a backup video from this same running build. If you shorten waits or move between screens, mark the edit. Do not use this prototype as proof of offline operation, a one-click installer, real enterprise approval, or a measured speed claim.

## Host preparation

This package is a Node HTTP server that binds `127.0.0.1:3011` by default. A public URL requires an approved HTTPS reverse proxy/tunnel, site-level access or rate control, data notice and a real load test. The server caps Gemini calls at 8/minute and one active request; this protects the demo but does not replace edge controls or stop public hosting costs. No public route or key is created by this package.

Run `npm run check` to syntax-check both JavaScript files. Stop with Ctrl+C. No application data is persisted, so stopping the process clears only in-memory throttling state. Google’s API documentation: https://ai.google.dev/gemini-api/docs/generate-content/text-generation and https://ai.google.dev/gemini-api/docs/rate-limits.
