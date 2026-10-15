# ADR: Hosted API route boundary

- Status: Proposed for the hosted demo hardening branch.
- Date: 2026-10-15
- Scope: Prevent non-document API handlers from running outside explicit local deployment mode.

## Decision

A root `proxy.ts` matcher covers `/api/:path*` and runs before route handlers. In `EZAGENT_DEPLOYMENT_MODE=local`, requests pass through to preserve the packaged local app behavior. In hosted or invalid deployment mode, every API path outside `/api/documents` is denied with a no-store `503` response before its handler executes.

There are no non-document exceptions. In particular, `/api/chat`, `/api/agent/*`, `/api/local-ai`, `/api/local-app/health`, and `/api/demo-invoices` are denied in hosted or invalid mode. The `EZAGENT_HOSTED_DOCUMENTS_ENABLED` feature flag does not weaken this boundary when it is off, on, or invalid. `/api/documents/*` passes through only to its existing document-specific runtime, origin, session, and authorization checks; this proxy does not grant document access.

The deployment mode comes only from server environment configuration through `readDocumentRuntimeMode`. `Host`, `Origin`, fetch-site, query, and body values cannot opt a request into local mode.

## Verification and limits

Tests enumerate route files under `app/api`, check the root proxy matcher, and exercise every declared method in hosted and invalid modes with forged localhost headers. They verify the non-document response is returned before route handling and cover hosted-document feature flag values `0`, `1`, and invalid. Local-mode tests verify existing APIs continue through the proxy.

This is a code boundary, not a deployment approval. Hosted deployment remains blocked until the owner approves deployment and its environment is configured with `EZAGENT_DEPLOYMENT_MODE=hosted`. Local mode remains intended for the packaged local application.
