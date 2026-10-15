# ADR: Phase 4 approval contract groundwork

- Status: Proposed; code-only contract and synthetic tests, not an authorization to enable approvals.
- Date: 2026-10-15
- Scope: Worker A Phase 4 groundwork on `codex/worker-a-phase4-approval-contract`.

## Decision

Define a fail-closed contract for preparing and recording a synthetic approval decision. The feature flag `EZAGENT_PHASE4_APPROVALS_ENABLED` defaults off; only the exact value `1` enables the contract. No route, UI, real identity source, durable store, invoice issuance, numbering, payment, or production decision flow is added.

The contract has three server-side boundaries:

1. `TrustedActorProvider` resolves a verified actor, organization, and role set. Request body, query parameters, and client-selected roles are not identity evidence. The default provider returns no actor.
2. `ApprovalMaterialProvider` loads the current draft and source order within the verified organization and supplies the server-generated export digest and policy version. The proposal request can select only a draft ID; the provider must scope and reload the material.
3. `ApprovalProposalRepository` reads and writes proposals by server-derived organization and server-issued proposal ID. Missing storage fails closed.

Preparation requires `documents:prepare`, a reviewed draft whose `reviewedRevision` equals its current revision, and a matching review digest. A proposal binds the following canonical values:

| Field | Bound value |
| --- | --- |
| Organization and policy | `organizationId`, `policyVersion` |
| Source | Source order ID, revision, and canonical digest, or `null` |
| Draft | `draftId`, `draftRevision`, `reviewDigest` |
| Amounts | Server-computed totals and `totalsDigest` |
| Export | Server-generated `exportDigest` |
| Integrity | `bindingDigest` over the canonical binding body |

Decision requires `documents:approve`, a different actor from the preparer, an organization-scoped proposal lookup, and a fresh server material load. Any changed review, order revision/content, policy, totals, or export digest makes the proposal stale.

## Atomic decision and audit boundary

`AtomicApprovalDecisionCommitter.appendIfCurrent` is a required integration boundary. Its future durable implementation must atomically reload current organization-scoped material, compare the expected binding digest, and append the decision using durable idempotency. A separate read followed by an append has a time-of-check/time-of-use race and is not a conforming implementation. The repository contains only a synthetic in-memory test double; it is not a production adapter.

Audit entries are explicitly scoped `synthetic_proposal_only`. They record actor, organization, proposal, decision, policy, binding digest, idempotency digest, and ledger-owned timestamp, with sequence and previous-entry hash. An idempotent retry returns the original entry and timestamp when all decision-defining fields match; reusing the key for a different decision, actor, proposal, organization, policy, or binding is a conflict. The hash chain detects accidental or partial modification when verified, but is not immutable storage or cryptographic attestation against a privileged writer who can rewrite the entire ledger.

## Fail-closed and rollout constraints

- The feature is disabled unless explicitly enabled in the supplied environment; invalid flag values are unavailable.
- Missing identity, material, proposal persistence, or atomic decision storage cannot produce a recorded decision.
- No caller-supplied actor, organization, role, draft object, order object, totals, or export hash is accepted as trusted material.
- No actual approval is issued, and no invoice, number, payment, external service, or production resource is changed.
- Enabling real decisions requires a separate review and implementation of authenticated identity/authorization, durable organization-scoped stores, atomic compare-and-append with durable idempotency, operational audit retention, and an explicit rollout decision.

## Verification

Synthetic tests cover default-off behavior, missing providers, organization scoping, self-approval refusal, reviewed-draft tampering, stale source/export revisions, decision-time race rejection, hash-chain verification, restart/idempotency behavior, and failed or mismatched audit responses. These tests do not establish the security of a future provider or durable adapter.
