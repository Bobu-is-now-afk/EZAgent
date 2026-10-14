# Hosted demo hardening

## Plan-to-source binding

Each accepted `/api/demo/jobs` request now returns a server-issued `planVersion`, source name/type, and SHA-256 of the exact UTF-8 source content. The plan queue persists only this binding metadata; source content and planner results remain in process memory.

Hosted `/api/agent/runs` requests must carry `planBinding: { jobId, planVersion, sourceSha256 }`. The server resolves the job under the current visitor owner and requires a completed job whose version, hash, name, and type match the submitted source. Missing, expired, interrupted, cancelled, unknown, or mismatched bindings return HTTP 409 `replan_required`. The existing workflow validator still governs supported workflow edits. Created Run records retain the job ID, plan version, and source hash.

Queue records written by older versions have no trusted source digest. They are migrated to interrupted records and cannot authorize a Run. Replan after upgrading.

## Hosted data notice and readiness

The demo publishes `/demo-data-policy` as a static route. It states the current data handling, local storage, retention, deletion, logging, and backup limitations. `EZAGENT_DEMO_DATA_POLICY_URL` must equal this owned route. Capability readiness checks the route handler's status, content type, revision header, title, and full notice body; missing or changed policy content disables planning and Run capabilities.

This check does not verify host, reverse-proxy, platform log or backup configuration. Those remain explicitly unverified in the notice. Hosted release approval remains disabled until the other release gates are met.
