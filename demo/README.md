# EZAgent judge demo

This standalone page is adapted from the teammate's public repository at
https://github.com/saya-zhandev/ezagent (commit `abee346`, 2026-10-18).

All demo data and replies are pre-scripted. The Mac mini M6 is an assumed profile, not detected
hardware. Setup and the `qwen3.5:9b` download are animations. Agent Builder
previews the roles in [agent-team-spec.md](./agent-team-spec.md); it does not
run five agents or save a reusable tool. The separate
[document studio](./documents.html) makes a SAMPLE draft, never issues or sends
one.

## Public demo boundary

With Vercel Root Directory `demo`, the browser uses fixed fictional scripts and
does not call a model API. The former `/api/chat`, `/api/agent-suggest`, and
`/api/document-suggest` routes return HTTP 410 `scripted_demo_only` even if a
key remains configured. `/api/status` reports `scripted_demo`. The separate
local product prototype uses Ollama `qwen3.5:9b` on a Mac mini. The separate
[EZAgent Product Web Preview](https://ezagent-product-web-preview.vercel.app/)
is accessible from this demo's home page. Neither public website contacts the Mac mini.

The prior Gemini adapter is retained as historical implementation material.
Remove `GEMINI_API_KEY` from the public Vercel project after this scripted
version is deployed; the active routes do not use it.

Deploy this folder with Root Directory `demo` and Production Branch `main` only
after the separate deployment approval. This branch has not changed the public
site or Vercel configuration.
