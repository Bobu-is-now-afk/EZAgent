# EZAgent judge demo landing

This standalone page is adapted from the teammate's public repository at
https://github.com/saya-zhandev/ezagent (commit `abee346`, 2026-10-18).

This is a static, judge-facing concept preview. All demo data is synthetic.
The Mac mini M6 is an assumed device profile, not detected hardware. Setup and
the Qwen 3.5 · 9B model download are animations; they install or download
nothing. The Agent Builder screen is a proposed structure, not an executable
multi-agent system or a reusable-tool creator.

## Live Gemini backend seam

Chat and Agent use labelled sample drafts when the backend is not configured.
The page has no provider key and does not save backend credentials. A
same-origin server-side proxy is expected at the Vercel project root:

- `GET /api/status` reports configuration only:
  `{"configured":true,"connectivity":"not_checked","source":"gemini","model":"…"}`
  (or `configured:false`). This status never proves a model request ran.
- `POST /api/chat` accepts only a server-owned `fixtureId` from
  `study_schedule`, `cache_comparison`, or `launch_checklist`.
- `POST /api/agent-suggest` accepts only `fixtureId: "synthetic_document_task"`,
  which maps to the server-owned synthetic workshop quote fixture.
  The browser never sends free-form text to a live endpoint.
- Successful Chat responses use
  `{"status":"live","source":"gemini","model":"…","answer":"…"}`.
- Successful Agent responses use
  `{"status":"live","source":"gemini","model":"…","roles":[…],"proposedSteps":[…],"missing":[…]}`.
  The UI renders these as proposed roles/steps and human-review items; it does
  not treat the proposal as executed work.
- Errors return a non-2xx response and may include `{"status":"error","error":"…"}`.
  The UI shows the error and never substitutes a sample for a failed live request.
- `/api/document-suggest` accepts the server-owned `workshop_quote` fixture.
  Its UI belongs to the separate `documents.html` experience; the Agent Builder
  links there when that page is present.

When this folder is the Vercel Root Directory, these routes resolve at `/api/*`.
No raw Ollama URL or model override is exposed in the public Settings dialog.
The Gemini route implementation is maintained separately from this static page.

The agent team shape and role names are recorded in [agent-team-spec.md](./agent-team-spec.md).
Run `node --test tests/demo/live-response.test.mjs` to check the Chat and Agent
success-response contracts and their live-state validation.

Deploy this folder as a separate Vercel project with Root Directory `demo` and
Production Branch `main`. Do not put API keys in `index.html` or expose a raw
model service publicly. A protected server-side Gemini proxy is needed for live
AI.
