# EZAgent

EZAgent is a local development prototype for chat and a bounded invoice workflow. The current agent demo uses a local Ollama `qwen3.5:9b` proposal, editable Logic Pills, deterministic invoice processing, persisted Run state, and CSV results with source references. It is not yet a packaged, general-purpose agent platform.

## Run locally

With project dependencies and Ollama already installed, start `qwen3.5:9b` in Ollama, then run `npm run dev`. Open the local URL printed by Next.js. The app uses the same-origin Next API routes and Ollama on `127.0.0.1:11434`.

- [Demo steps and expected results](docs/agent-demo.md)
- [Agent state and API contract](docs/agent-contract.md)
- [Dynamic Logic Pills and their execution boundary](docs/logic-pills.md)
- [Local execution boundary and unverified claims](docs/offline-boundary.md)

Synthetic demo files are in `data/demo/`. Imported Run data is stored in ignored `.ezagent/`; do not commit it. CSV and header-based TXT are supported. PDF/XLSX import, arbitrary agent tools, Tauri packaging, and disconnected-network validation are not part of the current build.
