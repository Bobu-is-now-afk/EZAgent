# Judge demo product plan

**Scope:** one synthetic request-to-quotation story for the public-facing judge demo. Keep the existing Vercel project root at `demo/`; this plan does not change that folder, production settings, or deployment.

## Current inventory

| Area | Present on `main` (`9ed9d0b`, PR #19) | Gap |
|---|---|---|
| Public entry | Static `demo/index.html`; setup and `qwen3.5:9b` download are visibly simulated | No Mac mini profile; setup is generic |
| Chat/agent | Ollama-compatible browser endpoint if configured; otherwise labeled sample output; Agent plans generic steps | No Gemini adapter, spec-driven builder, or manager/worker roles |
| Documents | No quotation flow in public `demo/` | The separate app branch in PR #21 contains a synthetic quotation workbench, but is based on `codex/yolanda-friction-reduce`, not `main` |
| Related PRs | #20 has evidence/runbook docs; #22 clarifies previous invoice-run state | #20–#22 also target the alternate base; integrate selectively after rebasing/reviewing, not as an implicit merge bundle |

## Current implementation progress and gaps (2026-10-19)

PRs #24–#26 are open against `main`, but no single integrated PR combines them with `codex/judge-facing-demo`:

| Work | Present progress | Integration gap |
|---|---|---|
| #24 Gemini contract | Defines same-origin routes, fail-closed behavior, five fixed roles, source boundaries, and public cost gates | Contract says public live service stays disabled until access/rate limits and provider budget controls are approved |
| #25 Gemini adapter | Same-origin status/chat/agent/document endpoints; server-owned fixture IDs; bounded provider calls; errors do not fall back to samples | Chat returns `answer`; Agent returns `roles`, `proposedSteps`, and `missing`. The current `judge-facing-demo` client expects `reply` for both, so it will reject valid responses unless adapted |
| #26 document page | Standalone `documents.html`; manual field application/confirmation; integer-cent totals; quotation/receipt preview and failure state | It is not linked from the current landing branch. Its prompt is still “Create a quote for two workshop days next month,” not a receipt source, so it does not yet satisfy a receipts-to-quotation story |
| `codex/judge-facing-demo` | Landing labels M6/Qwen as simulated; labels replies live only after a successful response; request errors remain errors; fixed five-role concept is visibly simulated and defined in `agent-team-spec.md` | Sample mode is automatic when the backend is unavailable, with no explicit mode choice. The team screen hardcodes the role diagram instead of loading/rendering the Markdown spec. Document page and API are not present in this branch |

The integration should retain the correct existing labels and fail-closed behavior. Before calling the end-to-end flow complete, add an explicit Sample demo mode choice when Gemini is not configured/unreachable; keep a connected Gemini request failure in an error state with retry or deliberate switch-to-sample. Use an actual synthetic receipt fixture as the source for the quotation, then allow only grounded item/quantity suggestions. Keep identity, price, currency, tax, and dates blank unless explicitly supplied and confirmed by a person. Treat the Markdown file as the team structure source of truth, and label its static choreography simulated.

## One judge-facing flow

1. **Preview setup:** show a clearly fictional “Mac mini M6 demo profile” (all specs marked simulated; no claim of an announced or tested product configuration). Animate the `qwen3.5:9b` download with a persistent **Simulated — no device setup or model download occurs** label.
2. **Choose execution:** show **Gemini connected — live response** only when the protected server-side Gemini adapter is configured and reachable. When Gemini is not configured or not connected, let the judge explicitly choose **Sample demo mode**. If a Gemini request fails after connection, show a clear error with retry/switch-to-sample choices; never silently replace the failed live response with a sample. Never expose API credentials in the browser. Keep local-model setup simulation separate from Gemini status.
3. **Build the agent:** load a short Markdown spec and render this fixed hierarchy: **GM → 2 mini managers → 2 workers**. The spec names each role, allowed tools, handoff, and approval gate. Label static role assignments and handoff animations **Simulated**; show a handoff as completed only after that action actually ran. Do not imply parallel execution or tool access that the backend did not perform.
4. **Start from a synthetic receipt:** show a clearly marked sample receipt fixture and ask **“Use this receipt to prepare a quotation draft.”** Offer two explicit paths: **Do this once** (one-off task) and **Save as reusable tool** (preview a reusable workflow; saving is local demo state only unless persistence is implemented and labeled).
5. **Draft and review:** use a generic quotation/receipt template inspired by InkVoice’s visual simplicity, without copying its branding or implying affiliation. AI may suggest only source-grounded fields with visible provenance; leave unknown seller/buyer identity, date, currency, price, and tax blank. A person edits and confirms every required value.
6. **Show deterministic result:** calculate subtotal, tax, and total with integer minor units after explicit currency and tax choices. Keep a `SAMPLE · DRAFT` preview visible, and label every backend-dependent action **Live** or **Simulated**. No numbering, issuance, sending, payment, or customer data.

## Add / defer / remove

| Decision | Scope |
|---|---|
| Add | A bounded demo state machine joining setup → Gemini/demo-mode chat → spec-based GM/manager/worker view → one-off/reusable choice → receipt-to-quotation draft → human review and deterministic preview. Add exact synthetic fixtures and visible live/simulated labels. |
| Defer | Real Mac hardware detection or claims; actual local model installation; arbitrary agent authoring, unrestricted tools, background jobs, durable reusable-tool storage, auth, real customer/order data, production Gemini deployment until a protected adapter is available, real quotation issuance/numbering/sending/payments. |
| Remove or replace in this demo path | Generic Agent sample chips and canned multi-step agent output as evidence of real orchestration; direct browser-to-Ollama configuration as the primary live path. Keep the static landing and its simulation disclosure. Treat PR #22’s old invoice-run state enhancement as outside this quotation journey unless the app’s source-change UX is reused deliberately. |

## User-facing copy

- Setup: **“Mac mini M6 demo profile · Simulated”** / **“No device was detected or configured.”**
- Model: **“qwen3.5:9b download · Simulated”** / **“This animation does not download or install a model.”**
- Runtime: **“Gemini · Live”** only after a successful protected-backend check; if unavailable, offer **“Sample demo mode · Simulated responses.”** If a live request fails, show **“Gemini request failed. Retry or switch to sample mode.”**
- Agent: **“GM coordinates two mini managers and two workers from this Markdown spec. Static role assignments are simulated; completed handoffs appear only after they run.”**
- Choice: **“Do this once”** / **“Save as reusable tool · demo preview.”**
- Quotation: **“Suggestions are drafts. Check each source and enter missing values. Totals are calculated from the values you confirm.”**
- Footer/preview: **“SAMPLE · DRAFT — not issued or sent. No payment is requested.”**

## Acceptance cases

| Case | Pass condition |
|---|---|
| Setup disclosure | Mac mini profile and model-download animation remain explicitly simulated on narrow and wide layouts; no install command runs. |
| Gemini unavailable | No secret or raw endpoint appears; judge can explicitly choose Sample demo mode and sample output is unmistakably synthetic. |
| Gemini available | Protected server reports ready; one prompt receives a live Gemini response, labeled Live. A failed live request shows an explicit error and retry/switch choices; no sample is substituted silently. |
| Spec hierarchy | A supplied Markdown fixture renders one GM, exactly two mini managers, and exactly two workers with visible spec-derived assignments/handoffs. Static choreography is labeled simulated; a handoff is marked completed only after it actually ran. |
| API/client contract | Chat and Agent UI accept the documented #25 response shapes (`answer`; `roles`/`proposedSteps`/`missing`) and validate them; malformed or failed responses stay in an explicit error state. |
| One-off/reusable choice | Both choices are available; one-off does not persist. Reusable choice states whether it is a preview or actually saved and can be reset without affecting other data. |
| Receipt suggestions | A visible synthetic receipt is the source for the quotation. Suggestions match only explicit receipt facts and show provenance. Unsupported/ambiguous facts remain blank for manual review; no invented identity, date, price, currency, or tax. |
| Human review | Missing/invalid fields block confirmation and print; edits update provenance; totals refresh deterministically. |
| Arithmetic | Fixed fixture produces the documented expected total; invalid amounts, quantity, currency, or tax block preview confirmation. |
| No real issuance | Preview is always visibly SAMPLE/DRAFT; no document number, outbound request, payment action, or real customer record is created. |

## Integration order

1. Keep #19 as the public Vercel root and stable entry point; add a concise link/entry to the integrated story without changing Root Directory `demo`.
2. Carry #24’s API/error and public cost gates into integration. Keep Live disabled until approved access/rate limits and provider budget controls exist; otherwise offer explicit Sample demo mode.
3. Integrate #25 and adapt the landing client to the documented response shapes (`answer` for Chat; fixed `roles` plus bounded `proposedSteps`/`missing` for Agent). Test success, malformed response, provider error, and explicit sample selection independently.
4. Use the Markdown team spec as the source for the static five-role diagram and mark all simulated assignments/handoffs as simulated. Do not show completed work unless a deterministic action actually ran.
5. Integrate #26’s document page and link it from the existing landing. Replace the quote-request fixture with a clearly synthetic receipt source and keep grounded suggestions separate until human application/confirmation. Reuse its deterministic totals and print gates.
6. Fold in relevant evidence/runbook material from #20 after checking it against the final interaction. Leave #22 out unless its run-state UX is needed for this path.
7. Run acceptance cases against the integrated branch, update evidence/runbook, and open a review PR. Deployment and any Vercel project changes remain separate decisions.

**Rollback:** revert the integration PR; the static `demo/` root from #19 remains the baseline. No data migration or external state is part of this plan.
