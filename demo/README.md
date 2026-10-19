# EZAgent judge demo

This standalone page is adapted from the teammate's public repository at
https://github.com/saya-zhandev/ezagent (commit `abee346`, 2026-10-18).

All demo data is synthetic. The Mac mini M6 is an assumed profile, not detected
hardware. Setup and the `qwen3.5:9b` download are animations. Agent Builder
previews the roles in [agent-team-spec.md](./agent-team-spec.md); it does not
run five agents or save a reusable tool. The separate
[document studio](./documents.html) makes a SAMPLE draft, never issues or sends
one.

## Gemini boundary

With Vercel Root Directory `demo`, the same-origin functions in `api/` accept
only server-owned synthetic fixture IDs. `GET /api/status` reports whether the
server has a key; `connectivity: "not_checked"` does not prove a model request
ran. `POST /api/chat` returns `answer`; `POST /api/agent-suggest` returns fixed
roles with proposed steps; `POST /api/document-suggest` returns bounded field
suggestions. A successful response is labelled `status: "live"`,
`source: "gemini"`, and includes the model. Non-2xx responses are errors, not
sample replies. The browser never receives the key or a raw Ollama URL.

The endpoints and local tests are documented in
[demo-gemini.md](../docs/demo-gemini.md). Keep `GEMINI_API_KEY` unset on the
public site until access control, distributed rate limits, and provider-side
usage controls are approved and verified. The in-memory limiter in this demo
does not cap spending across Vercel instances.

Deploy this folder with Root Directory `demo` and Production Branch `main` only
after the separate deployment approval. This branch has not changed the public
site or Vercel configuration.
