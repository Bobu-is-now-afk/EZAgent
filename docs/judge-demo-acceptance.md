# Judge demo acceptance contract

Status: proposed; reviewed 2026-10-19. This document defines how to accept the synthetic custom-wording-to-quotation demo. It is not a claim that the quotation path, local packaging, offline operation, or usability gates have passed.

## Bounded demo

The demo takes one synthetic custom wording input:

```text
Create a quote for two workshop days next month.
```

It may suggest the item description and quantity as editable concepts. It must leave the buyer, seller, date, currency, unit price, and tax treatment unresolved unless the user supplies them. A suggested value must be visibly distinguished from a user-provided or verified value. The demo must not invent a date, buyer, price, currency, or tax rule.

The user supplies the missing fields, reviews the complete draft, and explicitly confirms before printing the completed quotation preview. An incomplete `SAMPLE · INCOMPLETE DRAFT` preview may remain visible, but printing/export must stay disabled. For the reproducible happy path, enter seller `Sample Studio`, buyer `Demo Workshop Co`, valid-until `2026-11-30`, currency `HKD`, unit price `1250.00`, and confirmed tax treatment `No tax`. Keep the suggested description `Workshop day` and quantity `2` only after review. Expected subtotal / tax / total: `HKD 2,500.00` / `HKD 0.00` / `HKD 2,500.00`. These are explicit synthetic test inputs, not values inferred from the source wording.

## Acceptance gates

1. **Same-input repeatability:** run the exact input twice with the same explicit user values. Compare the normalized quotation fields and integer minor-unit totals. They must match. Ignore generated IDs and timestamps only if the product clearly marks them as metadata.
2. **Missing-field refusal:** leave all required fields blank, then leave seller, buyer, date, currency, price, and tax treatment blank individually. The app must identify each missing field, keep explicit review confirmation and printing/export unavailable, and must not fill guessed values. The visible incomplete sample preview may remain on screen but must say it is incomplete.
3. **Invalid-input recovery:** reject malformed or negative price, non-positive or fractional quantity, unsupported currency, and an invalid tax rate with a specific visible error. Correct the value and continue without losing other user-entered fields. The current UI reports these in the review error list, not beside each field.
4. **Inference boundary:** the quotation concept parser is deterministic and does not call a model. Model/runtime identity is not applicable to this path. Do not imply AI inference occurred. Local model inference is a separate capability and requires its own live request evidence.
5. **Draft reset recovery:** use **Start over** to clear a completed draft, then create a fresh draft from the same source and verify the review lock returns. This is a reset-path check, not an app-relaunch or persistence test.
6. **Print output:** print the reviewed sample and inspect the generated PDF for all agreed fields and totals, page count, clipping, and unwanted blank pages. Record browser, OS, paper size, and output method.
7. **Refresh behavior:** refresh after completing a draft and record whether the draft is restored or reset. Do not describe data as persistent unless the exact saved-state path is verified.
8. **Human usability:** five first-time nontechnical participants must complete the task. Record sample size, time to completion, completion rate, wrong clicks, requests for help, and false beliefs about AI or approval. This gate remains pending until sessions are run.
9. **Clean install and offline:** test the declared target on a clean account/device; install, complete the task, relaunch, and repeat with network disconnected. This gate remains pending until the packaged app and required resources are available. It applies to the installed product, not this concept parser's offline behavior in a development server.

## Separate local invoice workflow

The local `/invoice-demo` Ollama planner and deterministic invoice Run are a separate product path from the quotation concept parser. The quotation acceptance gates above cannot be satisfied by an invoice plan, installed model, or invoice CSV. See the J-05 evidence row and runbook section for the exact local commit, synthetic goal, bounded model request, output and remaining recovery gaps.

## Evidence rule

Use [judge-demo-evidence.md](judge-demo-evidence.md) for dated observations and run status, and [judge-demo-runbook.md](judge-demo-runbook.md) for the repeatable sequence. A test result applies only to the exact path and environment recorded. A Vercel prototype, invoice workflow, unit test, or installed model does not pass the quotation acceptance gates by implication.
