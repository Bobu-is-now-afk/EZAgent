# Judge preview: synthetic-only Mac gateway

## Scope and audit

This stacked change builds on PR #18 (base commit 839eba0), rather than copying its gateway. The judge must run **scripts/judge_gateway.mjs**, not the general gateway or demo/model-demo copy. The new adapter is a copyable example for the separate website; this repository does not establish its deployment.

PR #18 already provides bearer comparison, loopback binding, one inference, 12 accepted calls per fixed 60-second window, input/output limits and startup model preflight. Gaps for this use case:
- General chat accepts arbitrary messages and caller-defined tools; a system prompt is not a synthetic-data boundary.
- Upstream JSON is returned unchanged; judge output needs an allowlist.
- Default fetch redirects can move requests beyond the intended endpoint.
- Health reports process liveness, not successful inference or external connectivity.
- Public adapter requires independently verified access control. Origin checks cannot authenticate judges.

Related open PRs #24/#25 use Gemini; #27/#29 concern judge-facing/scripted presentation. Their titles and branch relationships were inspected; their implementation was not audited. This change does not replace or wire any of those branches. PR #18 is itself stacked on #17; do not merge this directly into main without reviewing the dependency chain.

## Contract and limits

Browser -> protected preview /api/judge-demo -> approved HTTPS /v1/synthetic -> loopback Ollama.

POST body is exactly {"scenario":"design"}, {"scenario":"print"}, or {"scenario":"consultation"}. No free text, uploads, PII, model name, tools, URLs, or caller options. These public fixtures are authored here, not copied from business data.

The model classifies one fixed fictional sentence. Output must match the selected fixture; otherwise return an error. The code calculates fixed HKD amounts (800, 120, 500). Response: demoOnly=true, status=draft_only, source=live_model, scenario, item, currency, amount. No model prose or hidden reasoning is returned. This is model classification plus deterministic demo pricing, not autonomous quoting or execution.

- Gateway listens only on 127.0.0.1:8766. Ollama stays on loopback port 11434.
- Authenticated GET /healthz is **liveness only**. Startup checks installed qwen3.5:9b. A successful synthetic POST is the readiness/inference check.
- Generic /v1/chat/completions is 404 on this entrypoint.
- Input 128 bytes, upstream response 1 MiB, projected output below 1 KiB; model 512 tokens, one call, 45-second timeout.
- One active inference, no queue; 12 accepted calls per fixed minute per process, with possible boundary bursts; 32 connections max. Socket inactivity timeout 55 seconds. Restart resets counters.
- Adapter timeout 50 seconds; function budget 60 seconds. Shared gateway limits do not limit Vercel invocation cost. No automatic retries.
- Busy: 429 and Retry-After 5. Offline, timeout, malformed output: adapter 503. UI preserves scenario selection and offers manual retry. Never silently substitute scripted results labelled live.
- No request, response, authorization or secret logging. Reverse-proxy/platform logging must also redact authorization.

## Copyable environment variable names

Separate Vercel project, **Preview environment only**, optionally scoped to its integration branch:

```text
JUDGE_GATEWAY_URL
JUDGE_GATEWAY_API_KEY
JUDGE_DEMO_ENABLED
```

JUDGE_GATEWAY_URL is the owner-approved stable HTTPS endpoint ending /v1/synthetic, without credentials, query or fragment. JUDGE_GATEWAY_API_KEY is the same value as Mac runtime MODEL_GATEWAY_API_KEY. Mark it Sensitive. JUDGE_DEMO_ENABLED stays false until access controls and routing pass acceptance; true enables this adapter only when VERCEL_ENV is preview. VERCEL_ENV is provided by Vercel, not a user secret. Never use NEXT_PUBLIC_ names.

After BOB explicitly approves configuration:
1. In the existing secret manager UI, select an existing dedicated demo credential (32–256 bytes). If none exists, BOB must approve generation; use the manager's secure password generator and save only within that manager.
2. Transfer the value directly using the manager's protected copy/autofill into Vercel's Sensitive value field. Do not paste into chat, terminal commands, files, PRs or screenshots. Clear clipboard history according to the manager's policy.
3. Inject the matching value into Mac process environment as MODEL_GATEWAY_API_KEY using the existing manager's runtime integration. Do not export to .env or shell startup files; do not use shell tracing. Then run node scripts/judge_gateway.mjs.
4. Do not use vercel env pull or any export that materializes secret values in files. Values are deliberately absent from this document.
5. Copy examples/judge-next/app/api/judge-demo/route.mjs as app/api/judge-demo/route.js in the separate Next.js site. No package installation required.
6. Changes to variables require a new approved Preview deployment.

The enabled flag is NOT authentication. Vercel Deployment Protection must cover both the page and /api/judge-demo, with an approved judge access method, plus an approved edge request limit. This example has no application login. Do not release it unprotected or add a browser-visible gateway key.

References: [Sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [environment scopes](https://vercel.com/docs/environment-variables), [Deployment Protection](https://vercel.com/docs/deployment-protection).

## Acceptance matrix and release gates

Automated locally:
- node --test tests/model-gateway.test.mjs tests/judge-adapter.test.mjs
- sh scripts/check_local.sh
- node --check scripts/judge_gateway.mjs
- git diff --check

Still required after approval, with synthetic data only:
1. Mac: verify loopback listener addresses, installed model, unauthenticated health 401, authenticated health 200; run all three scenario POSTs. Record status, duration and model version only. Test cold start and p95 latency; no latency promise exists yet.
2. Approved HTTPS route: verify it maps only port 8766, refuses general chat and cannot reach 11434; wrong credential 401; redirects fail closed. External network routing is not created by this PR.
3. Preview: signed-out requests to both page/API blocked by platform protection; authorized judge succeeds. Inspect browser requests and bundle for absence of gateway authorization values. Verify deployed env scope excludes Production.
4. Two simultaneous requests: one accepted, other 429. Thirteenth accepted attempt within one minute: 429. Test edge limit separately, including anonymous traffic, before public access.
5. Stop gateway, stop Ollama, simulate >45-second inference, malformed output, and missing model: readable unavailable UI, no fake success, manual retry recovers. Do not stop any existing service without owner approval.
6. Confirm browser-visible 429/503 copy, no unhandled exceptions, no auto-retry storm and an explicitly labelled scripted fallback.
7. Complete an actual judge-browser -> Vercel -> gateway -> model run before claiming connectivity.

These are pending gates, not completed tests. No live model or deployed Vercel connectivity is claimed by this change.

## Rollback

Local-only implementation: revert this commit; stop only its gateway process. No schema/data migrations. If routing/deployment is later approved, disable the demo flag and redeploy the Preview; remove the approved route and revoke the dedicated key through the existing manager. Those external and credential changes require BOB approval. Never expose port 11434. No production setting, public tunnel, credential creation or Vercel mutation is performed here.

## Recorded verification for this revision

13 gateway/adapter tests passed; repository check passed (14 Python tests, 143 Node tests, TypeScript and diff check). next build --webpack passed using the already installed dependencies. Default Turbopack build could not resolve the worktree's external node_modules symlink; no dependency installation was performed. This repository defines no lint script. The example adapter was exercised directly with Web Request/Response and mocked upstream; it is not installed in this repository's Next app or verified in the separate judge site.
