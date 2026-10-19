# EZAgent judge demo landing

This standalone page is adapted from the teammate's public repository at
https://github.com/saya-zhandev/ezagent (commit `abee346`, 2026-10-18).

The setup sequence is a simulation. This branch adds same-origin Gemini server
routes for fixed synthetic prompts, draft workflow planning, and a synthetic
quote. It does not add real workflow execution. The static page integration is
being handled separately; Gemini failures must remain explicit errors rather
than silently switching to samples.

Deploy this folder as a separate Vercel project with Root Directory `demo` and
Production Branch `main`. The server routes and setup are documented in
[`../docs/demo-gemini.md`](../docs/demo-gemini.md). Do not put API keys in
`index.html`. Public endpoints are anonymous and per-instance rate limits are
not an account-wide spend cap; keep the live key unset until shared access and
provider-side usage controls are ready.
