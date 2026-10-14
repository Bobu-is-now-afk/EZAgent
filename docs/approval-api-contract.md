# Approval API contract (proposal)

Status: draft for Worker A alignment; not implemented and not release evidence. The browser-only Review prototype remains a demo. The UI must not call approval/export operations until server authentication, authorization, durable storage, and audit behavior are implemented and tested.

## Trust and version binding

- The server derives `actorId`, organization, and role from an authenticated session. Request bodies never select or override identity or role. Operator and manager are distinct authenticated accounts. Approval is denied whenever the approver's actor ID matches any actor who created or materially edited the current version, even if that actor also has the manager role.
- A review version is immutable and identified by `batchId` plus monotonically increasing `revision`. Mutations require `If-Match: "<revision>"` and a non-empty reason.
- The server stores the accepted source and computes `sourceSha256` over the exact UTF-8 bytes it accepted. It computes `workflowSha256` from canonical validated workflow JSON and `planSha256` from the canonical validated plan. `resultSha256` binds the immutable, format-independent validated result model encoded as UTF-8 canonical JSON with stable schema and property order. Before approval, the server materializes each supported export format and computes the SHA-256 of its exact bytes.
- An approval binds one tuple: `{ batchId, revision, sourceSha256, workflowVersion, workflowSha256, planSha256, resultVersion, resultSha256, exportArtifacts }`. `exportArtifacts` contains a version and exact-byte SHA-256 for each supported format (`json`, `csv`, `txt`). The server resolves and validates each member from persisted records; the client cannot substitute another version at approval or export time.
- Any source, rules/workflow, plan, calculation, or output change creates a new revision and atomically invalidates the current approval. Revocation is a new decision event; it does not erase a prior approval or recall an already downloaded file.
- The decision log is append-only to ordinary application roles. Each approve, reject, revoke, and invalidation event records server timestamp, authenticated actor ID, action, required reason, batch/revision, and the bound hash/version tuple. No UI or API operation updates or deletes a prior decision event.

## Proposed endpoints

The following resource names are a proposal to align with the current `ReviewBatch` and `ApprovalSnapshot` types. Worker A may map them to existing route conventions while preserving the semantics and status codes below.

### `GET /api/review/batches/{batchId}`

Returns the caller's authorized current batch, immutable revision, computed result status, current approval status, and allowed actions. Cross-organization and nonexistent IDs both return `404`.

### `PATCH /api/review/batches/{batchId}`

Creates the next immutable revision. Requires `If-Match`, a non-empty `reason`, and an allowlisted set of editable fields. The server recalculates affected facts and invalidates any current approval in the same transaction. The response includes the new revision and current approval state.

### `POST /api/review/batches/{batchId}/approvals`

Creates a manager decision for the server's current, calculated revision. Requires a non-empty `reason`, `If-Match`, and an idempotency key. The server rejects self-approval by actor ID and rechecks blockers and all bound hashes under the same transaction that appends the event.

Request:

```json
{
  "revision": 7,
  "sourceSha256": "<expected sha256>",
  "workflowVersion": 3,
  "workflowSha256": "<expected sha256>",
  "planSha256": "<expected sha256>",
  "resultVersion": 2,
  "resultSha256": "<expected canonical-result sha256>",
  "exportArtifacts": {
    "json": { "version": 1, "sha256": "<exact JSON bytes sha256>" },
    "csv": { "version": 1, "sha256": "<exact CSV bytes sha256>" },
    "txt": { "version": 1, "sha256": "<exact TXT bytes sha256>" }
  },
  "reason": "Reviewed exceptions and confirmed the current result."
}
```

Response:

```json
{
  "approvalId": "apr_…",
  "status": "approved",
  "decision": {
    "actorId": "usr_…",
    "role": "manager",
    "at": "2026-01-01T00:00:00.000Z",
    "reason": "Reviewed exceptions and confirmed the current result."
  },
  "binding": {
    "batchId": "batch_…",
    "revision": 7,
    "sourceSha256": "<sha256>",
    "workflowVersion": 3,
    "workflowSha256": "<sha256>",
    "planSha256": "<sha256>",
    "resultVersion": 2,
    "resultSha256": "<canonical-result sha256>",
    "exportArtifacts": {
      "json": { "version": 1, "sha256": "<exact JSON bytes sha256>" },
      "csv": { "version": 1, "sha256": "<exact CSV bytes sha256>" },
      "txt": { "version": 1, "sha256": "<exact TXT bytes sha256>" }
    }
  }
}
```

`actorId`, role, timestamp, approval ID, binding, canonical result hash, and all export artifact hashes in the response are server-generated. The echoed client expectations do not replace server-side resolution.

### `POST /api/review/batches/{batchId}/rejections`

Appends a manager rejection decision for the current revision. Requires an authenticated manager, `If-Match`, and a non-empty reason. The response includes the rejection event ID and current revision; it does not delete the batch or any earlier decision. A later material edit creates a new revision and a new decision cycle.

### `POST /api/review/batches/{batchId}/revocations`

Appends a manager revocation event for the current approval. Requires an authenticated manager, `If-Match`, and a reason. The response returns `status: "revoked"` plus the prior `approvalId`; the earlier approval event remains in history.

### `GET /api/review/batches/{batchId}/decisions`

Returns authorized append-only decision history, including invalidation and revocation events. It does not expose source contents beyond the caller's batch permission.

### `POST /api/review/batches/{batchId}/exports`

Streams or creates an export only when the authenticated caller can export and the current revision has a non-revoked approval whose complete binding still matches the server's current source, workflow, plan, canonical result, and export artifact hashes. Requires `approvalId`, `revision`, and one allowlisted format (`json`, `csv`, or `txt`). The server regenerates that format, hashes the exact response bytes, and compares them to the approved hash before returning them; the response includes `X-Artifact-SHA256`. Previously downloaded files cannot be recalled.

## Error contract

All errors use a stable JSON envelope: `{ "error": { "code": "…", "message": "…", "requestId": "…" } }`. Messages must not disclose another organization's records or internal credentials.

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `authentication_required` | No valid authenticated session. |
| 403 | `role_forbidden` | Authenticated identity lacks the action's role. |
| 403 | `self_approval_forbidden` | Approver actor ID matches any creator or material editor of the current version, even when the approver also has manager role. |
| 404 | `not_found` | Batch is absent or outside caller's organization. |
| 409 | `revision_conflict` | `If-Match` is stale; return current revision only to an authorized caller. |
| 409 | `approval_binding_mismatch` | Current source, workflow, plan, canonical result, or selected export bytes differ from the approval request. |
| 409 | `approval_invalidated` | Approval is revoked or invalidated and cannot authorize export. |
| 409 | `idempotency_conflict` | Idempotency key was reused with a different request body. |
| 422 | `approval_blocked` | Current calculation or required review evidence is incomplete; include safe blocker codes. |
| 422 | `reason_required` | Decision or material edit lacks a reason. |
| 429 | `rate_limited` | Caller or service limit reached; include `Retry-After`. |
| 503 | `approval_store_unavailable` | Durable store is unavailable; fail closed and do not report approval or export success. |

## Required verification before UI integration

1. Anonymous requests receive `401`; forged body roles and self-approval by any creator or material editor receive `403`, including a manager who created or materially edited the current revision.
2. A caller from another organization cannot read, mutate, approve, revoke, or export a batch, even with a guessed ID.
3. Stale revision, source, workflow, plan, canonical-result, and each supported format's exact-byte hash independently prevent approval and export.
4. Material edits invalidate approval atomically. A concurrent edit/approve/export has one serialized outcome; no stale approval can authorize bytes from a newer revision.
5. Restart the service after approval, edit, revocation, and export. Current state and decision history survive; ordinary APIs cannot rewrite or delete prior decision events.
6. Duplicate idempotent approval requests create at most one decision event. Reusing a key with different content fails.
7. Export is denied without the current approval; JSON, CSV, and TXT response bytes each hash to the matching approved format-specific artifact hash.
8. UI role controls are removed. The UI displays only server-returned identity, current decision state, reasons, and errors; it never treats local state as authorization.

The approval store, account provider, retention/deletion/backup policy, and operational alerting remain Worker A dependencies. This proposal does not authorize production data, broad release, or an SME pilot.
