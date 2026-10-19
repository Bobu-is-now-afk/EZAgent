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

PR #28 now carries the three-record source set at commit `e25601a`. Its 8/8 test result is reported in the PR description; the added test asserts that the visible page source exactly matches the server-owned fixture and checks that W-02 and R-01 are context only.

| Work | Present progress | Integration gap |
|---|---|---|
| #24 Gemini contract | Defines same-origin routes, fail-closed behavior, five fixed roles, source boundaries, and public cost gates | Contract says public live service stays disabled until access/rate limits and provider budget controls are approved |
| #25 Gemini adapter | Same-origin status/chat/agent/document endpoints; server-owned fixture IDs; bounded provider calls; errors do not fall back to samples | Response contract is adapted in #28; public live use remains gated on approved access/rate and budget controls |
| #26 document page | Standalone `documents.html`; manual field application/confirmation; integer-cent totals; quotation/receipt preview and failure state | Integrated and linked in #28; selected quote source is still Order W-01, not Receipt R-01 |
| #28 integrated candidate | Landing, same-origin API, document studio, mock-backend browser replay, fixture-only input, and fixed W-01/W-02/R-01 source text are integrated; PR description reports 8/8 API tests | The quote is generated from Order W-01, not Receipt R-01. Call this an **order/receipt context to quotation** demo; do not claim receipt-to-quotation extraction |
| `codex/judge-facing-demo` | Landing labels M6/Qwen as simulated; labels replies live only after a successful response; request errors remain errors; fixed five-role concept is visibly simulated and defined in `agent-team-spec.md` | Sample mode is automatic when the backend is unavailable, with no explicit mode choice. The team screen hardcodes the role diagram instead of loading/rendering the Markdown spec. This branch predates the integrated document page and API |

PR #28 is reviewable as a fixed **synthetic order/receipt context → one quotation draft** path: the UI and server share the same three-record fixture, only W-01 feeds the quote, W-02/R-01 remain context, and R-01 has no payment evidence. Do not describe this as receipt-to-quotation extraction; that would require selecting R-01 as the quote source. Remaining product checks are to keep the offline Sample mode visible before preset prompts run, ensure a live-call failure remains an error, and describe the existing rerun as local deterministic recalculation rather than rerunning Gemini or the records. Keep identity, price, currency, tax, and dates blank unless a person supplies and confirms them. The five-role Markdown builder remains a simulated preview, not an executed team.

## One judge-facing flow

1. **Preview setup:** show a clearly fictional “Mac mini M6 demo profile” (all specs marked simulated; no claim of an announced or tested product configuration). Animate the `qwen3.5:9b` download with a persistent **Simulated — no device setup or model download occurs** label.
2. **Choose execution:** show **Gemini connected — live response** only when the protected server-side Gemini adapter is configured and reachable. When Gemini is not configured or not connected, let the judge explicitly choose **Sample demo mode**. If a Gemini request fails after connection, show a clear error with retry/switch-to-sample choices; never silently replace the failed live response with a sample. Never expose API credentials in the browser. Keep local-model setup simulation separate from Gemini status.
3. **Build the agent:** load a short Markdown spec and render this fixed hierarchy: **GM → 2 mini managers → 2 workers**. The spec names each role, allowed tools, handoff, and approval gate. Label static role assignments and handoff animations **Simulated**; show a handoff as completed only after that action actually ran. Do not imply parallel execution or tool access that the backend did not perform.
4. **Start from synthetic records:** show the fixed source text for Order W-01, Order W-02, and Receipt R-01. W-01 is the only quote source; mark W-02 and R-01 **Context only**. State that Receipt R-01 has no payment evidence. Offer **“Prepare one quotation from Order W-01”** or **“Preview reusable tool.”** The first creates one draft from W-01; the second shows the static role/spec concept. The copy says only W-01 enters the quote and no batch processing is claimed.
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
| Gemini unavailable | No secret or raw endpoint appears; UI states Sample mode before preset prompts run and sample output is unmistakably synthetic. |
| Gemini available | Protected server reports ready; one prompt receives a live Gemini response, labeled Live. A failed live request shows an explicit error and retry/switch choices; no sample is substituted silently. |
| Spec hierarchy | A supplied Markdown fixture renders one GM, exactly two mini managers, and exactly two workers with visible spec-derived assignments/handoffs. Static choreography is labeled simulated; a handoff is marked completed only after it actually ran. |
| API/client contract | Chat and Agent UI accept the documented #25 response shapes (`answer`; `roles`/`proposedSteps`/`missing`) and validate them; malformed or failed responses stay in an explicit error state. |
| One-off/reusable choice | Both choices are available; one-off does not persist. Reusable choice states whether it is a preview or actually saved and can be reset without affecting other data. |
| Synthetic source set | Exactly three fixed records appear: Order W-01 (selected quote source), Order W-02 (context only), and Receipt R-01 (context only; no payment evidence). The page text exactly matches the server-owned source constant. The UI says **order/receipt context to quotation**; it does not claim the receipt generated the quote. |
| Recalculation | **Rerun calculation** preserves current quote inputs and total, clears field confirmations, and increments a local rerun count. It does not call Gemini again or process W-02/R-01. UI copy must keep this distinction clear. |
| Source suggestions | Suggestions match only explicit facts from Order W-01 and show provenance. Unsupported/ambiguous facts remain blank for manual review; no invented identity, date, price, currency, or tax. |
| Human review | Missing/invalid fields block confirmation and print; edits update provenance; totals refresh deterministically. |
| Arithmetic | Fixed fixture produces the documented expected total; invalid amounts, quantity, currency, or tax block preview confirmation. |
| No real issuance | Preview is always visibly SAMPLE/DRAFT; no document number, outbound request, payment action, or real customer record is created. |

## Final three-record fixture plan and copy

Keep the three fixed synthetic records from PR #28 as the source of truth; do not add a second invented fixture set. The page and server must use matching values and stable IDs. The browser displays all three records, but the quote request sends only Order W-01's allowlisted ID, never an array or uploaded source. W-02 and R-01 are context only; R-01 has no payment evidence. The demo shows no historical amount copied into the new quote.

| Record | Role in demo | Required label |
|---|---|---|
| Order W-01 | The only source selected to create the quotation draft | **Selected quote source · SAMPLE** |
| Order W-02 | Context only; never sent in the quote suggestion request | **Context only · SAMPLE** |
| Receipt R-01 | Context only; no payment evidence and never treated as payment proof | **Context only · SAMPLE · no payment evidence** |

Recommended exact UI copy:

- Section: **“Synthetic orders and receipt · simulated records”**
- Helper: **“Choose one sample record. Order W-01 creates one quotation draft; Order W-02 and Receipt R-01 are context only. No batch is run.”**
- Cards: **“Order W-01 · Selected quote source”**, **“Order W-02 · Context only”**, **“Receipt R-01 · Context only · no payment evidence.”**
- Action: **“Prepare one quotation from Order W-01”** / **“Preview reusable tool.”**
- Draft source: **“Selected source · Order W-01.”** Keep seller, buyer, quote date, currency, new unit price, and tax blank for human entry/confirmation. Suggestions may propose only source-grounded description and quantity.
- Rerun: keep the implemented **“Rerun calculation”** label and describe it as **“Recalculates this draft from the same entered values. It does not rerun Gemini or process the other records; confirmations reset for review.”** Rename the count to **“Calculation reruns”** so it cannot be read as a batch run count.
- Quote preview: **“SAMPLE · DRAFT”** and **“New quotation total.”** Do not present Receipt R-01 as the source or as payment proof.

Acceptance: the document suggestion call uses the fixed server-owned fixture; suggestions are bounded to W-01 and amount/identity/tax are not inferred. Rerunning recalculates only the current draft and does not call Gemini or touch W-02/R-01. The UI never says “processed all records” or “batch complete,” and never implies upload or real data. Deterministic quote totals use only manually entered and confirmed quote fields.

## Integration order

1. Keep #19 as the public Vercel root and stable entry point; add a concise link/entry to the integrated story without changing Root Directory `demo`.
2. Carry #24’s API/error and public cost gates into integration. Keep Live disabled until approved access/rate limits and provider budget controls exist; otherwise offer explicit Sample demo mode.
3. Integrate #25 and adapt the landing client to the documented response shapes (`answer` for Chat; fixed `roles` plus bounded `proposedSteps`/`missing` for Agent). Test success, malformed response, provider error, and explicit sample selection independently.
4. Use the Markdown team spec as the source for the static five-role diagram and mark all simulated assignments/handoffs as simulated. Do not show completed work unless a deterministic action actually ran.
5. Keep #28’s three fixed source records aligned between page and server. Label Order W-01 as the quote source and W-02/R-01 as context only. Keep grounded suggestions separate until human application/confirmation. Describe the existing rerun accurately as deterministic recalculation, then retain totals and print gates.
6. Fold in relevant evidence/runbook material from #20 after checking it against the final interaction. Leave #22 out unless its run-state UX is needed for this path.
7. Run acceptance cases against the integrated branch, update evidence/runbook, and open a review PR. Deployment and any Vercel project changes remain separate decisions.

**Rollback:** revert the integration PR; the static `demo/` root from #19 remains the baseline. No data migration or external state is part of this plan.
