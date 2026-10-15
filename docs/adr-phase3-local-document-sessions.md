# ADR: Default-off hosted document sessions and resource controls

**Status:** Approved for code-only Phase 3 work under the product owner's Phase 3 directive
**Date:** 2026-10-15
**Scope:** Code, tests, documentation and a draft PR only. No deployment, endpoint exposure, real customer data, account/certificate/firewall/permission changes, or Ollama exposure.

## Context

The document workbench currently uses one `.ezagent/documents` snapshot for every caller. Its API checks loopback host/origin and `EZAGENT_DOCUMENTS_ENABLED`; it does not authenticate a hosted caller or assign a server-verified owner. JSON bodies are limited to 64 KiB. Suggestions use a process-global busy flag and a 30-second timeout, without a queue or durable rate/daily counters. The current clear-data action clears the whole snapshot.

Phase 3 needs a controlled, synthetic-only hosted demo path. The prior local app must keep its existing local data namespace. Phase 3 does not provide real-user attribution or company approval; those remain Phase 4.

## Decision

### Feature gate and session

- Keep the hosted document mode disabled unless `EZAGENT_HOSTED_DOCUMENTS_ENABLED=1` and every required session, policy, and limits setting validates. Missing, malformed, or insecure configuration returns a generic unavailable response and never falls back to a shared/local owner.
- Admit demo sessions with a pre-provisioned list of distinct invite IDs and access tokens held only in the process environment. Sign opaque session claims with a separate environment-only HMAC secret of at least 32 bytes. Compare fixed-length token digests in constant time. Do not log, persist, echo, or include token or signing-secret values in errors.
- Set an `HttpOnly`, `Secure`, `SameSite=Strict`, path-scoped cookie with a finite expiry. Require matching Origin on mutations and reject cross-site requests. A distinct pre-provisioned invite creates an anonymous demo workspace; it is not an identity provider and does not establish a person's name or company role.
- Require one exact HTTPS `EZAGENT_DOCUMENTS_ALLOWED_ORIGIN`; do not accept wildcards or infer a trusted client address from `X-Forwarded-For`/`X-Real-IP`. Hosted mode accepts only HTTPS request URLs. A future reverse-proxy integration must provide a separately reviewed trusted-proxy adapter before use.
- Derive owner ID only from a validated signed session. Ignore and reject owner IDs supplied by a body, query, or custom header.

Hosted mode requires these values; any missing/invalid value leaves the feature off:

| Setting | Contract |
|---|---|
| `EZAGENT_HOSTED_DOCUMENTS_ENABLED` | Must equal `1`; absent means off. |
| `EZAGENT_DOCUMENTS_ACCESS_TOKENS_JSON` | Environment-only JSON array of at most 10 unique `{id, token}` entries. IDs are stable non-secret labels; each token is at least 32 bytes. Each judge gets a distinct token. |
| `EZAGENT_DOCUMENTS_SESSION_SECRET` | Separate environment-only HMAC secret; at least 32 bytes. |
| `EZAGENT_DOCUMENTS_ALLOWED_ORIGIN` | One exact `https://` origin; no path, wildcard, or comma-separated list. |
| `EZAGENT_DOCUMENTS_POLICY_VERSION` | Must equal the bundled policy version `2026-10-15-v1`. |
| `EZAGENT_DOCUMENTS_SESSION_TTL_SECONDS` | Required integer from 300 to 28,800 seconds. |
| `EZAGENT_DOCUMENTS_MAX_OWNERS` | Required integer from 1 to 10. |
| `EZAGENT_DOCUMENTS_REQUESTS_PER_MINUTE` | Required integer from 1 to 30 per owner. |
| `EZAGENT_DOCUMENTS_GLOBAL_REQUESTS_PER_MINUTE` | Required integer from 1 to 300 across all owners. |
| `EZAGENT_DOCUMENTS_DAILY_SUGGESTIONS` | Required integer from 1 to 20 per owner, reset at 00:00 UTC. |
| `EZAGENT_DOCUMENTS_MAX_ACTIVE_SUGGESTIONS` | Must equal `1` for the current local Ollama capacity assumption. |
| `EZAGENT_DOCUMENTS_MAX_QUEUE` | Required integer from 0 to 2. |
| `EZAGENT_DOCUMENTS_MAX_QUEUE_WAIT_MS` | Required integer from 0 to 15,000. |
| `EZAGENT_DOCUMENTS_SUGGESTION_TIMEOUT_MS` | Required integer from 1,000 to 30,000. |

Body (64 KiB), URL (2 KiB), per-owner record counts and snapshot-size limits are hard code ceilings and are not widened by environment settings.

### Isolation and resource controls

- Keep local app documents in the existing local path. Store hosted demo data in an owner-specific namespace under `.ezagent/documents/owners/<server-issued-owner-id>/`; never migrate or expose legacy ownerless records. A session clear affects only its own namespace and preserves its sample sequence.
- Persist a mapping from configured invite ID to server-issued owner ID in the durable control registry. Re-authentication with the same invite resumes the same owner, so cookie expiry, revocation and retries cannot reset rate or daily caps. A new invite ID consumes one of the finite owner slots; owner slots are not recycled automatically. Session logout revokes that session nonce but does not clear its documents or free its owner slot.
- Route every hosted list, read, create, update, review, suggestion, sample, export and clear operation through the same authenticated owner context.
- Preserve the 64 KiB body and add a 2 KiB URL ceiling. Require explicit finite settings before enabling hosted mode: at most 10 active owners, 30 requests per owner per minute, 20 suggestions per owner per UTC day, one active model request globally, at most two queued suggestions, 15-second maximum queue wait, and the existing 30-second model timeout. Keep the current 250 orders, 250 drafts, 1,000 suggestions, 1,000 samples and 10 MiB snapshot limit as per-owner hard caps. Validate integer ranges and reject values above these code maxima.
- Persist rate, daily-cap and global admission state under the existing cross-process file-lock discipline. Admission is atomic across local processes. Queue wait is bounded; client disconnect/cancel releases its queue slot and aborts its model request; restart recovery treats unfinished suggestions as incomplete and releases stale admission leases without reporting success.
- If a durable admission-state write fails, reject the request. Never fall back to a process-only counter.
- If hosted mode is enabled, every document endpoint—including requests whose Host claims `localhost`—uses hosted HTTPS/session/policy checks and owner storage. It must never fall back to the old local namespace. When hosted mode is disabled, preserve the existing local-app guard and path.
- Do not claim per-IP rate limiting: the current request API has no trusted peer-address source, and client forwarding headers are spoofable. Per-owner and global admission limits are enforceable now; per-IP protection requires a trusted proxy adapter and is a later deployment prerequisite.
- Retain the current suggestion input/output character ceilings and set the local model context ceiling explicitly; the model remains on loopback. Do not add a network model or third-party endpoint.

### Data policy

- Provide one canonical local policy definition used by both `/data-policy` and the server gate. If it is unavailable or its configured version does not match, hosted document mode fails closed.
- State that this demo accepts synthetic data only; browser data is processed on the Mac mini and persisted in the owner's host-side namespace. State the exact document records and counters stored, the 64 KiB/request and suggestion caps, local Ollama behavior, and the current retention/deletion behavior.
- No automatic retention deletion is introduced in this phase. Expired/revoked sessions cannot access their old namespace; data remains until the operator clears that namespace. The policy must say so and must not promise backup, log, or incident guarantees the application does not implement.

## Options considered

| Option | Assessment |
|---|---|
| Add owner IDs to the existing shared snapshot | Simpler file layout, but legacy ownerless rows and every query/update/clear path need a migration-sensitive audit. Rejected for Phase 3. |
| Separate owner namespaces with a signed session and a shared durable admission file | Keeps local data untouched and makes ownership part of store selection. Adds lock/state code, but can fail closed on every boundary. Selected. |
| Rely on loopback/Origin and process-memory limits | Already suitable for the local app, but neither authenticates hosted callers nor survives multiple processes/restarts. Rejected for hosted mode. |

## Consequences and limits

- Phase 3 sessions isolate anonymous demo workspaces through distinct pre-provisioned bearer invites; they do not authenticate a real person or organization. Reusing one invite deliberately reopens the same workspace. Do not use real customer documents or claim production readiness.
- The limits are conservative code ceilings, not Mac mini capacity findings. Public/demo concurrency remains unapproved until Phase 3 load testing on the target host.
- Session signing-key rotation invalidates active cookies. Invite tokens and signing secret must be configured out of band and are never written to files or Git.
- Owner slots are durable and are not reclaimed when a session expires or is revoked. Invite IDs must be distinct for distinct demo owners. There is no in-app owner-registry purge in this phase.
- Old local ownerless records remain in the local namespace and are not copied or assigned to hosted owners.
- The current store is one JSON snapshot per owner with a 10 MiB hard ceiling. Owner namespaces bound cross-tenant access but do not provide database-scale write throughput; actual target-host concurrency remains a later measured gate.

## Rollback

1. Disable hosted mode by unsetting `EZAGENT_HOSTED_DOCUMENTS_ENABLED`; session and document routes then fail closed. This is the immediate stop switch.
2. Revert the Phase 3 PR if code rollback is needed. The revert does not delete any hosted owner namespace.
3. Do not enable a public endpoint as part of rollback or validation. Any later deployment, account/certificate/firewall change, or namespace deletion requires its own concrete review and explicit approval.

## Verification plan

- Verify disabled-by-default and missing/invalid policy, access-token, signing-secret and limit settings fail closed.
- Verify local-host spoof headers cannot make a hosted-mode request fall through to the legacy local namespace; verify repeating one invite resumes one owner and a new invite cannot reset existing quotas.
- Verify token/session tampering, expiry, cookie flags, Origin/CSRF checks, owner substitution and cross-owner CRUD/clear/export denial.
- Verify 64 KiB boundary, rate and daily caps, global concurrency, queue ceiling/wait, cancellation, timeout, lock/write failure and restart behavior across separate processes.
- Verify the policy route and the API gate use the same version and text, and test policy-unavailable behavior.
- Run existing local document and packaged-workbench tests to prove local namespace behavior remains intact. Use synthetic fixtures only.
- Keep the PR draft until an independent Auditor reviews the boundary. No deployment or public-exposure claim is part of this PR.
