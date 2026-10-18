# Judge demo acceptance contract

Status: proposed; reviewed 2026-10-19. This document defines how to accept the synthetic order-to-quotation demo. It is not a claim that the quotation path, local packaging, offline operation, or usability gates have passed.

## Bounded demo

The demo takes one synthetic custom wording input:

```text
Create a quote for two workshop days next month.
```

It may suggest the item description and quantity as editable concepts. It must leave the buyer, seller, date, currency, unit price, and tax treatment unresolved unless the user supplies them. A suggested value must be visibly distinguished from a user-provided or verified value. The demo must not invent a date, buyer, price, currency, or tax rule.

The user supplies the missing fields, reviews the complete draft, and explicitly confirms before a quotation preview is produced. For the reproducible happy path, enter seller `Sample Studio`, buyer `Demo Workshop Co`, valid-until `2026-11-30`, currency `HKD`, unit price `1250.00`, and confirmed tax treatment `No tax`. Keep the suggested description `Workshop day` and quantity `2` only after review. Expected subtotal / tax / total: `HKD 2,500.00` / `HKD 0.00` / `HKD 2,500.00`. These are explicit synthetic test inputs, not values inferred from the source wording.

## Acceptance gates

1. **Same-input repeatability:** run the exact input twice with the same explicit user values. Compare the normalized quotation fields and integer minor-unit totals. They must match. Ignore generated IDs and timestamps only if the product clearly marks them as metadata.
2. **Missing-field refusal:** leave buyer, date, price, currency, or tax treatment blank in turn. The app must keep preview/confirmation unavailable and identify the missing field. It must not fill a guessed value.
3. **Invalid-input recovery:** reject malformed price, non-positive or fractional quantity, unsupported currency, and an invalid tax rate with a specific inline error. Correct the value and continue without losing other user-entered fields.
4. **Model and runtime evidence:** record the actual model and execution environment only when observed during a real quotation run. An installed model or a page label alone does not prove it served the run.
5. **Live-demo resilience:** demonstrate recovery from a model/service unavailable state and a retry path without duplicating a quotation. Record any limitation; do not present a simulated service as a live inference.
6. **Human usability:** five first-time nontechnical participants must complete the task. Record sample size, time to completion, completion rate, wrong clicks, requests for help, and false beliefs about AI or approval. This gate remains pending until sessions are run.
7. **Clean install and offline:** test the declared target on a clean account/device; install, complete the task, relaunch, and repeat with network disconnected. This gate remains pending until the packaged app and required resources are available.

## Evidence rule

Use [judge-demo-evidence.md](judge-demo-evidence.md) for dated observations and run status, and [judge-demo-runbook.md](judge-demo-runbook.md) for the repeatable sequence. A test result applies only to the exact path and environment recorded. A Vercel prototype, invoice workflow, unit test, or installed model does not pass the quotation acceptance gates by implication.
