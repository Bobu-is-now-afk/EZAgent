# EZAgent judge demo: delivery and acceptance specification

Status: proposed acceptance contract, 2026-10-14. Product implementation and test evidence must be recorded separately. This document does not certify that a gate has passed.

## Goal and product boundary

Give a nontechnical judge a complete first-use experience: open EZAgent, run a synthetic invoice example, understand the plan, approve the exact work, inspect exceptions, and export a traceable result. Deliver the same bounded invoice capability through (1) a downloadable local edition and (2) a hosted demonstration using the Mac mini's `qwen3.5:9b` model. The local edition may claim offline operation only after its model and runtime have been installed and the disconnected test below passes. The web edition must say that submitted data is processed on the demo server.

The four phases below are sequential release gates. Passing one phase does not imply that later claims are true. The generic workflow builder remains a configuration and preview surface until a workflow type has an implemented executor.

## Phase 1 — judge journey and bounded invoice task

Owner: Planner and Worker B; Auditor verifies independently.

1. From Home, a first-time user can identify four paths: prepare local AI, chat, design a workflow, and try the invoice demo. Every path has a visible route home and a clear next action.
2. A judge can load bundled synthetic CSV data, create a plan, inspect source, currency, threshold, missing-field policy and output, then explicitly confirm the exact plan before execution. Planning alone never mutates data or creates an export.
3. Execution reports progress, completion, error and retry or cancel where supported. A successful run shows row count, flagged exceptions and source references, and exports a CSV that matches the inspected result. Repeating a run with the same inputs and confirmed rules yields the same deterministic output.
4. Builder preview and Review demo state their limits in the interface. A generic saved workflow cannot appear to have executed. Demo role switching cannot be presented as real authentication or company approval.
5. Test with at least five first-time nontechnical participants. Record time to first completed sample task, task completion rate, wrong clicks, requests for help and false beliefs about whether AI or approval actually ran. Fix any critical misunderstanding before the judge build is frozen.

Gate evidence: browser recording or reproducible notes for desktop and mobile, deterministic fixture/result assertion, build/typecheck, and a short participant findings log. The owner reports the measured times; there is no untested 30-second claim.

## Phase 2 — downloadable local edition

Owner: Worker A; Auditor verifies on a clean machine or clean user account.

1. Produce a signed or clearly identified development build for one declared target platform first. The judge receives one download and an illustrated first-run path without terminal commands. State supported OS, hardware, required free space, estimated model download, and expected first-run time before download begins.
2. Package the app runtime, required Python components and local service launch. Detect missing Ollama/model and offer an explicit, safe preparation path. Do not silently install system software or start a model download. Failed download leaves a usable state and a retry action.
3. On a clean machine, install, open, complete the synthetic invoice task, quit, relaunch and recover saved user state without a developer terminal. Model selection must reflect available memory and disk capacity.
4. After all required models and components are present, disconnect all network interfaces and repeat the invoice task and local chat. Confirm locally that app/model endpoints are loopback only and capture outbound connection attempts during the disconnected run.
5. Uninstall/reinstall and model-update behavior must be documented, including what happens to user data. No claim of universal zero setup until the clean-install test passes on each advertised platform.

Gate evidence: versioned install artifact with checksum, fresh-install recording, install/relaunch/offline results, supported-platform matrix, and reproducible build instructions. Windows and macOS are separate gates.

## Phase 3 — controlled web demo using the Mac mini model

Owner: Worker A for service and model path; Worker B for web journey; Auditor probes boundaries.

1. Host a web demo with its own explicit demo URL and HTTPS. The browser reaches a bounded backend endpoint; Ollama remains bound to loopback and is never directly exposed. The demo may run as a time-limited external service on this Mac mini, as authorized by the project owner.
2. The page labels the service as an online demo, explains that entered data reaches the Mac mini, and defaults to synthetic data. Real customer documents are rejected or the page clearly prohibits them until a documented data-handling process exists. Define retention, deletion, logging and backup behavior before opening access.
3. Set request-size, rate and concurrency limits, a queue with position or wait indication, request timeout, cancel behavior and a daily usage cap. The user sees a useful message when the model is busy, stopped or unreachable. A restart does not leave jobs falsely marked complete.
4. Run load tests on the actual Mac mini with one, two and the intended maximum number of simultaneous judges. Record p50/p95 time to first response, end-to-end completion, failure rate, memory use and recovery after stopping Ollama. Set the public concurrency limit from these measurements.
5. Provide a stop switch and health check. Keep access limited to the judge event or approved demo window until the security and capacity evidence is accepted. Do not describe the web version as offline.

Gate evidence: architecture/configuration review, external browser walkthrough, measured load results, data-handling notice, and a failure/recovery recording. Publishing the external service and changing firewall or account permissions remain separately controlled actions.

## Phase 4 — real approval and SME pilot

Owner: Planner defines workflow and pilot; Worker B implements approval; Worker A supplies persistence and operational controls; Auditor verifies the full boundary.

1. Authenticate distinct operator and manager accounts. Enforce approval on the server for the exact source hash, workflow version, plan and output version. The operator cannot approve their own run by changing a browser role control.
2. A material edit to source, rules or result invalidates prior approval. Export or downstream release follows the recorded approval policy. Every decision records actor, time, action, reason and immutable version references. Prove that the log survives process restart and cannot be altered through the ordinary UI.
3. A small business pilot uses consented, de-identified or otherwise authorized data. Define retention, deletion, backup and incident handling. Compare outputs to a human-reviewed answer set and report corrections, false approvals, missing exceptions and recovery time.
4. Publish claims only with evidence: deterministic output applies to the bounded executor and validated inputs; offline applies to tested local builds; enterprise approval applies only after authenticated, persistent enforcement; time-to-value is a measured distribution rather than an aspiration.

Gate evidence: role and tamper tests, restart/persistence test, pilot protocol, measured accuracy/correction report, and approval from the product owner before broad release.

## Work allocation and review loop

- **Planner (GPT-6 Sol, low):** turn this contract into an ordered backlog with dependencies and acceptance tests. Prioritize the judge journey, decide one first target OS, and send workers concrete tasks with file ownership. Re-plan when Auditor finds a material UX or release gap.
- **Auditor (GPT-6 Sol, low):** inspect each deliverable against this contract, challenge unsupported claims, run independent boundary and recovery checks, and report findings by severity with reproduction steps. Do not certify unrun tests.
- **Worker A (GPT-6 Luna, high):** packaging, local model lifecycle, offline verification, controlled Mac mini service, rate/concurrency limits and operational evidence.
- **Worker B (GPT-6 Luna, high):** judge-facing paths and copy, invoice result/recovery UX, web demo notices, and approval UX/backend contract as assigned by Planner.

Workers use separate branches or worktrees, keep changes reviewable, and report exact files, tests and remaining risks. Planner owns dependency order; Auditor reviews after each gate. Do not merge a gate based only on UI appearance. The existing `codex/yolanda-ux-redesign` draft PR is a starting point, not phase completion evidence.
