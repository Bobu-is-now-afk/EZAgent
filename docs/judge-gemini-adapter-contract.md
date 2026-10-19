# Judge demo: Gemini adapter contract

Status: integration plan, not a deployed capability. Baseline: `origin/main` at
`9ed9d0b` (2026-10-19). The Vercel project's Root Directory is `demo/`; this
document does not change that setting.

## Scope and current evidence

`demo/index.html` is a static judge page. Its setup/download sequence is a
simulation. Chat and Agent currently use a browser-configured Ollama-compatible
address, stored with a model name in `localStorage`, and show labelled samples
when that server is offline. This does not demonstrate a live Gemini service.

PR #18 contains a separate loopback Node prototype with a Gemini server
adapter. Its in-memory limit is useful for local rehearsal but does not apply
across Vercel Function instances. PR #21 contains a separate quotation draft
with deterministic totals and a human review gate. PR #22 clarifies prior
invoice Run labels. These paths are not integrated into this judge page. At
inspection, PR #21 and #22 have failing Vercel checks.

## Deployment boundary

Keep the existing static page and place same-origin Node Functions in
`demo/api/`, because `demo/` is the Vercel Root Directory. A root-repository
`app/api/` route belongs to the separate Next.js app and cannot serve this
deployment. Use `.mjs` for JavaScript Functions in this no-framework project,
or add an explicit `demo/package.json` module declaration. Confirm the final
URLs in a preview deployment before changing client calls.

The public browser sends only an allowlisted synthetic `fixtureId` to same-origin
`/api/*`; the server owns the corresponding prompt text. This makes the
synthetic-data-only boundary enforceable instead of relying on a notice beside
an unrestricted text box. The server
reads `GEMINI_API_KEY` from its process environment and calls an allowlisted
Gemini model. No key, provider endpoint, or arbitrary model selection appears
in HTML, bundled JavaScript, URL, browser storage, response, logs, or Git.
Remove the browser's editable API address/model setting when connecting live
routes. Never expose an Ollama or Gemini endpoint directly to the browser.

## API v1

Every request uses `POST`, `Content-Type: application/json`, body at most 4 KiB,
one allowlisted `fixtureId`, and a 30-second provider timeout. The server-side
fixture text is at most 1,200 characters. All responses use JSON and
`Cache-Control: no-store`. Reject unknown top-level keys, arbitrary `text`,
unsupported fixture IDs/templates, and invalid UTF-8/JSON before calling
Gemini. Bound output
tokens and validate the provider response against the route schema. Escape
model text when rendering; never treat it as HTML or executable instructions.

| Route | Input | 200 response data | Model authority |
| --- | --- | --- | --- |
| `/api/chat` | `{ "fixtureId": "study_schedule" \| "cache_comparison" \| "launch_checklist" }` | `{ "answer": string }` | Text reply only; no tools or task completion claim. |
| `/api/agent-suggest` | `{ "fixtureId": "synthetic_document_task", "template"?: "documents" \| "review" \| "other" }` | `{ "roles": Role[], "proposedSteps": string[], "missing": string[] }` | Configuration suggestion only; no agent execution or deployment. |
| `/api/document-suggest` | `{ "fixtureId": "workshop_quote" }` | `{ "suggestion": { "buyer": string, "description": string, "quantity": number \| null, "missing": string[] } }` | Extract only explicit facts; no price, tax, bank details, payment, exact inferred date, or approval. |

The UI shows the selected synthetic source sentence or task next to each
action. Any free-form chat box is disabled or explicitly marked as a separate
unavailable capability on the public site. Accepting arbitrary audience text
would require a separate privacy, abuse, and access-control review.

Successful live responses include `status: "live"`, `source: "gemini"`, and
the actual allowlisted `model` identifier. A separately invoked static sample
must use `status: "simulation"` and `source: "simulation"`; it is never an API
success fallback. Errors have non-2xx HTTP status and
`{ "status": "error", "error": ErrorCode }`, without provider prompt, response,
stack, or key. Suggested codes: `invalid_input` (400), `request_too_large`
(413), `rate_limited` (429), `not_configured` (503), `provider_timeout` (504),
`provider_unavailable` or `invalid_provider_response` (502). A Gemini failure
must not turn a pending UI step green or mark the task done.

`Role` is `{ "id": "gm" | "research_manager" | "delivery_manager" |
"analysis_worker" | "document_worker", "label": string,
"responsibility": string }`. Exactly one of each ID is required, in that
order. Limit arrays and strings server-side. Do not accept role count or
permissions from the model. The server may use fixed role metadata and ask
Gemini only for short task-specific suggested steps and missing information.

## Agent-builder role spec (Markdown source of truth)

```markdown
# Agent builder — concept simulation

- GM (1): Receives the synthetic task; proposes division of work and review
  criteria. Cannot approve, deploy, or assert execution.
- Mini manager, Research (1): Identifies facts to verify and missing inputs.
- Mini manager, Delivery (1): Proposes sequence, dependencies, and human checks.
- Worker, Analysis (1): Drafts an analysis approach using synthetic inputs only.
- Worker, Document (1): Drafts document fields without assigning amount, tax,
  payment status, or approval.

The diagram previews roles and suggested handoffs. It does not run five models,
schedule agents, execute tools, verify manager identity, or deploy a workflow.
"Generated" means the suggestion arrived; "completed" is reserved for a
separately verified deterministic action.
```

## Document and provenance boundary

For an InkVoice-inspired document view, display each suggested field as
`Gemini suggestion`; blank or rejected fields as `Needs user input`; changed
fields as `Entered manually`. The server only proposes buyer, description,
quantity, and missing fields from the server-owned synthetic sentence. A person
must apply or edit suggestions. Price, currency, tax treatment, seller,
validity date, and any payment evidence remain explicit user inputs. Calculate
amounts in deterministic code using integer minor units, enforce numeric
bounds, and require re-review after any edit. A preview is a SAMPLE draft; it
does not issue, send, or record a financial document. Receipt review remains
blocked without payment proof.

## Cost and abuse gate

The local PR #18 prototype allows eight calls/minute and one in-flight call
in one Node process. Stateless Vercel instances can each hold their own
counter, so this is not a public cost cap. Before setting a Gemini key for a
public judge URL, obtain approved site-level access or distributed rate
limiting, a provider-side quota/budget alert, and a measured request budget.
Start with a small fixed maximum output and no retries. Record aggregate
counts/status codes only; do not log user text or provider output. If these
controls are absent, leave live endpoints unconfigured and retain plainly
labelled simulation. Enabling a new external service, public access, and cost
limits requires owner sign-off under the project operating rules.

## Verification and rollback

1. Unit tests: reject malformed, excess, unknown-key, arbitrary-text, and
   non-allowlisted fixture inputs;
   accept valid bounded responses; reject missing/extra role IDs and forbidden
   document fields. Stub the provider; do not use a real key in CI.
2. Failure tests: missing key, 429, timeout, non-JSON/empty provider response,
   and network failure each return a non-2xx error and leave UI in error state.
3. Browser inspection: no key or provider endpoint in HTML, bundle, Network
   request body, browser storage, or console. Check live Gemini and simulation
   badges, keyboard use, and clear error copy.
4. Synthetic document check: suggested fields need application/review; price
   remains empty until entered; deterministic totals stay stable; editing
   invalidates prior confirmation; receipt cannot pass without evidence.
5. Preview deployment: confirm `/api/*` routes resolve under the `demo/` Root
   Directory and site-level throttling works; fix existing Vercel checks before
   release. Rehearse a provider outage and use a labelled backup capture.

Integrate on a feature branch and PR. Roll back by reverting the adapter and
client-wiring commit, then removing the deployment's Gemini environment
variable through the approved process. The static simulation remains available
and must keep its simulation badge. No production or Vercel setting is changed
by this document.
