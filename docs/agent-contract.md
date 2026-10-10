# EZAgent agent loop contract (demo v1)

The product uses one local `qwen3.5:9b` model through Ollama. Codex development chats are not part of the product runtime. The LLM proposes a workflow; the Node orchestrator owns state transitions, permissions, tool execution, and validation. Imported content is data, never an instruction. Only one run and one model call may be active at a time.

## Data model

- `WorkflowDefinition`: `version`, `goal`, `steps`, `parameters`, `allowedTools`, `acceptance`, and optional `pills`. Version starts at `1`. Maximum five ordered steps. Only known tool IDs and accepted parameter schemas are valid. `pills` are typed UI controls; bound pill IDs update existing tool parameters and acceptance criteria. Custom pill IDs are annotations only and grant no new tool capability. See [Logic Pills](logic-pills.md).
- `Run`: `id`, `workflowVersion`, `status`, `limits`, `currentTask`, `createdAt`, `updatedAt`, `workflow`, `taskStates`, `artifacts`. `status` is `draft | awaiting_approval | running | needs_input | failed | cancelling | cancelled | interrupted | completed`.
- `Task`: `id`, `dependencies`, `tool`, `inputRefs`, `acceptance`, `attempts`. Runtime task state is `pending | running | validating | passed | retry_pending | needs_input | failed`. A pending task cannot become passed without running and validating.
- `Artifact`: `id`, `type`, `location`, `sourceRefs`, `validation`. Source references use the imported file name and one-based row or line numbers.
- `ValidationResult`: `pass`, `code`, `evidence`, `retryable`.
- `RunEvent`: `id`, monotonic `sequence`, `runId`, optional `taskId`, `time`, `type`, `payload`.

Default limits: one active run, one model request, five tasks, three attempts per task including first execution, 20 model calls per run. Set and document finite call and run timeouts from measured local performance. Exhausted limits stop execution. Workflow changes after approval create a new version or a new run, never rewrite an existing run.

## HTTP contract

All routes live under `/api/agent` in the Node runtime. All error responses have `{ error: { code, message } }`; no secrets or source text in errors.

| Method and route | Request | Response |
| --- | --- | --- |
| `POST /plans` | `{ goal, source: { name, type: "csv" \| "text", content }, parameters?: { thresholdMinor, currency } }` | `{ workflow, preview }` where workflow is a validated proposal awaiting user approval. No tools run. |
| `POST /runs` | `{ workflow, source, idempotencyKey }` | `{ run }`. Requires the previously reviewed workflow payload, validates again, persists source under ignored `.ezagent/`, then starts asynchronously. Duplicate key returns the same run. |
| `GET /runs/:id` | — | `{ run }` with task states, artifact metadata, and validation evidence. |
| `GET /runs/:id/events?after=N` | — | `{ events, nextSequence }`, ordered, for reconnection. |
| `GET /runs/:id/stream?after=N` | — | SSE `RunEvent` stream, with heartbeat. UI must also support `GET events` fallback. |
| `POST /runs/:id/cancel` | — | `{ run }`; propagates abort and reaches `cancelled`. |
| `POST /runs/:id/resume` | `{ input?: ... }` | `{ run }`; only for `interrupted` or actionable `needs_input`, never repeats committed artifacts. |
| `GET /runs/:id/artifacts/:artifactId` | — | validated CSV download only; IDs are server resolved, not paths. |

Input maximum: 1 MiB text, 5,000 rows, UTF-8 CSV or plain text. The server owns all paths; no path from model or request is used as a filesystem path. API route handlers must not assume process or background work survives Next dev hot reload. On restart, any running run becomes `interrupted` and requires explicit resume. Snapshot writes are atomic, with one writer and monotonic event sequence. Imported sources and execution output remain outside `public/` and Git.

## Initial workflow tools and acceptance

The demo objective is: find invoice rows above HKD 10,000, flag missing required fields, and export CSV. Use deterministic tools for parsing CSV/plain-text invoice rows, normalizing existing fields, filtering by integer minor-unit amount and exact currency, validating required fields, and exporting CSV. Never invent missing values, add mixed currencies, overwrite sources, or permit CSV formula injection. The output contains source row references and validation status. Acceptance checks are executable and produce evidence. Manager model commentary cannot override a failed hard check.

The editor may render `number`, `text`, `tags`, and `select` pills dynamically, but the current planner and executable tool registry are still limited to this invoice pipeline. A custom pill remains workflow metadata and cannot make a clinical, insurance, or arbitrary file task executable.

The UI presents goal/input at left, a large editable workflow with Logic Pills in the center, result and source details at right, and real events below. A changed threshold must change the run payload and result. Save templates without imported content; rerun the same template with another source. Any replay must be labeled `Replay`.

## Ownership and rollback

- Worker a: `lib/agent/`, `app/api/agent/`, `tests/agent/` only.
- Worker b: `app/page.tsx` only; preserve Normal LLM.
- H: contract, `.gitignore`, integration, documentation, Git.
- Managers A/B: read-only review. No agent switches branches or edits shared files.

All implementation is reversible on the feature branch by reverting its commits. Run data and imported sources are not deleted during rollback; the operator may retain them for review.
