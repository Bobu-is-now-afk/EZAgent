# ADR: Replace the invoice intake demo with a document workbench

**Status:** Proposed  
**Date:** 2026-10-15  
**Decider:** Product owner  
**Source classification:** The InkVoice copy contains organization contact and payment defaults. Treat the copy as an internal reference. This public repository may contain only generic schema, layout and synthetic fixtures; configure real organization data outside source control.

## Context

The current EZAgent `/invoice-demo` filters a CSV of incoming invoices. The requested product task is different: create a quotation, invoice or receipt for work sold to a customer. The supplied InkVoice app already expresses the desired document fields and paper layouts, but it is a separate Vite app that saves one document in browser storage and allocates a number when a new draft opens. EZAgent has no order record or order list yet.

The user wants two ways to avoid repeated typing: select an order to carry known facts into a document, and describe custom work in ordinary language to get a proposed draft. A proposed document must remain editable and require explicit human review before issue or export.

## Decision

Build a native EZAgent document workbench at `/documents`. Make it the Home document entry. Keep the existing CSV executor as a legacy route during migration; stop advertising it as the main invoice task. Do not embed a second Vite server or copy the entire InkVoice project. Port the generic InkVoice paper templates as components with no company defaults, no payment account in source, and no new PDF dependency. Start with the generic minimal template; expose other variants only after they pass the same print and accessibility checks. Print styles provide browser PDF export for the first release; validate long-page behavior before claiming full PDF parity.

Use one versioned `DocumentDraft` schema for quotation, invoice and receipt. The draft records type, buyer, seller profile reference, currency, line items, terms, dates, linked order/document IDs, field provenance, review status and revision. A `DocumentIssue` record is separate and immutable. In the judge build, issue only in a synthetic demo namespace and mark every output **SAMPLE**. Its server-side atomic sequence is a test sequence, never a legal or company invoice number. A draft or AI suggestion never consumes a number. Real customer issue and numbering require authenticated identity, approval policy and a separate product-owner release decision.

When an order is selected, map its structured fields deterministically. Preserve order ID and version. If the order changes after draft creation, show the difference and require review. Never use an LLM to copy an already structured price, quantity, currency or customer identifier.

For custom wording, the local model returns a bounded `DraftSuggestion`: proposed text fields, candidate item descriptions, source excerpts and explicit missing fields. The server validates the JSON schema and rejects unrecognized keys. An unclear price, tax, payment status, bank account, quantity or customer identity stays blank and blocks issue until a human enters or confirms it. The UI shows each suggestion beside its source and applies it only after user confirmation. All totals use deterministic integer minor units; the model never computes the payable total.

The first release includes a manual order list inside EZAgent, as chosen by the product owner. Each order has an ID, revision and customer/item fields; saving or editing an order preserves the prior revision for draft provenance. Orders, drafts and sample documents persist in ignored `.ezagent/documents` local storage, outside Git, with a clear-data action that identifies and removes only this workbench's data after explicit user confirmation. Browser refresh and app restart must preserve them until that action. An external order integration can be added later through an adapter with explicit source ID, version and field mapping. Importing an order is a draft action; it never sends a document, creates a payment request or grants approval.

## Primary user path

1. Home → **Documents** → choose **From an order** or **Describe custom work**.
2. Order path: select order → inspect buyer, items, prices, dates and source version → choose quotation/invoice/receipt → create draft.
3. Custom path: describe work → local AI proposes only supported fields → inspect evidence and missing fields → apply selected suggestions to draft.
4. Both paths: edit all fields → deterministic totals and paper preview → validation checklist → explicit **Create sample document** → allocate a demo number → export/print SAMPLE PDF. The button does not issue a real invoice or request payment.
5. Quotation → invoice → receipt can link documents, but conversion requires a new review. Receipt requires a verified payment amount and date entered by a human or trusted payment record.

## Acceptance gates

- A first-time user creates all three document types from synthetic order data, edits an item, previews the generic InkVoice layout and exports without a terminal.
- Selecting the same synthetic order twice creates two drafts that point to the same order version; neither consumes a number until demo issue. Concurrent demo issue requests cannot duplicate a test number.
- An ambiguous prompt such as “make a quote for two workshop days next month” suggests a description while leaving price, exact dates and buyer blank. The interface explains what is missing.
- AI output with an extra key, invalid currency, negative quantity or fabricated price is rejected or left unapplied. Every accepted field shows its source and confirmation state.
- Editing an order, price, line item or terms after review invalidates the review status. An issued SAMPLE document remains immutable; corrections create a new revision, never overwrite the original. Real credit/cancellation policy is a later release decision.
- Browser refresh and app restart recover drafts. An export contains exactly the reviewed values and totals. Private profile/order data does not enter the public repo or shared synthetic fixture.
- Offline local edition works after model/runtime installation; hosted edition explicitly describes server processing and requires authenticated access to real order data. Both are separately tested.

## Migration and rollback

Keep `/invoice-demo` and its API available as a legacy demo while the new path is built. Change the Home entry only after the native workbench passes order→draft→issue→export browser testing. Place the new entry behind a feature flag during rollout. Roll back by disabling the flag and restoring the prior Home link; do not delete existing local drafts or invoice artifacts. The old CSV tests remain regression tests for the legacy path, not acceptance evidence for the new document workbench.

## Open decisions

- Define the backup/export contract for locally stored orders, drafts and samples; an external source adapter is a later option.
- Store real company contact, payment details and terms in an administrator-controlled profile outside public source control. The selected first style is the generic InkVoice minimal template.
- Decide who may issue documents, how numbering is scoped, and whether issue requires manager approval. These are policy choices; a demo role selector is not authorization.
- Confirm whether browser print-to-PDF is acceptable for the judge version or whether a dedicated renderer is required after page-break tests.
