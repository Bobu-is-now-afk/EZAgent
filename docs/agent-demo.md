# EZAgent local agent demo

This demo runs entirely on the local development machine. It uses the installed Ollama model `qwen3.5:9b` to propose a bounded invoice workflow. The Node orchestrator validates and executes five deterministic tools; the model does not execute files or shell commands.

## Start

1. Confirm Ollama is running locally and `qwen3.5:9b` is installed. The Planner connects to `http://127.0.0.1:11434`.
2. From this repository, run `npm run dev` and open the local URL printed by Next.js.
3. Open **Build Something (Main Stage)**. Select [invoices-batch-1.csv](../data/demo/invoices-batch-1.csv). The default goal asks for invoices strictly above HKD 10,000, missing required fields, and CSV export.
4. Click **建立計畫**. Review the five proposed steps and dynamically rendered Logic Pills. To change a value, click **修改計畫**, edit a bound pill, then click **完成修改**. The previous approval is invalidated. Custom pills are annotations only; they do not create executable tools. Check the approval box, then click **確認並建立 Run**.
5. Inspect the Run status, task validation evidence, RunEvent list, artifact source references, and CSV preview. Use **下載並檢視 CSV** for the complete file.
6. Save the workflow as a template. Load that version, select [invoices-batch-2.csv](../data/demo/invoices-batch-2.csv), approve the new source, and run again. Template storage excludes source rows, Run IDs, and artifacts.

Expected batch 1 output: `INV-001`, `INV-003`, `INV-004`, and `INV-006`. `INV-004` is flagged `missing_customer` and retains source row 5. The HKD 9,800 row and valid USD row are excluded. Expected batch 2 output: `INV-102`, `INV-103`, and `INV-104`; `INV-104` is flagged `missing_customer` at source row 5. Each output contains `source_file`, `source_row`, and `validation_status` columns.

## Verification

The following commands use existing dependencies and do not install packages:

```sh
npx tsc --noEmit
npx tsc --noEmit false --incremental false --strict --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --outDir /tmp/ezagent-agent-tests tests/agent/*.test.ts app/api/agent/**/*.ts
node --test /tmp/ezagent-agent-tests/tests/agent/*.test.js
npm run build
git diff --check
```

Node 20 cannot run these `.ts` tests directly with `node --test`; compile them first as above. The test suite covers planning bounds, pill types and bound edits, state transitions, source references, CSV formula safety, idempotency, restart recovery, correction/resume, cancellation, and SSE heartbeat. The local HTTP smoke also exercised plan, run, events, stream heartbeat, resume, cancel, and artifact routes. An earlier interactive browser check exercised plan approval, both demo batches, template save/load, Run state, events, and CSV preview. The new dynamic pill editor still requires a fresh interactive check. The in-app browser did not expose a download event during the earlier preview check, so the file download interaction was not independently confirmed there; the artifact HTTP response was confirmed.

## Data and limits

- The server stores imported sources, Run snapshots, events, and artifacts under ignored `.ezagent/`. Keep this directory for audit/recovery; do not commit it.
- Supported inputs are UTF-8 CSV and header-based TXT invoice rows, up to 1 MiB and 5,000 rows. PDF and XLSX import are not implemented.
- One Run and one local model request may be active at a time. The workflow has at most five steps, three attempts per task, and finite model/run timeouts.
- `needs_input` can accept a bounded correction to the filter currency or minor-unit threshold. It does not rewrite the imported source. Runs interrupted by a process restart require explicit resume. Cancellation prevents a completed artifact from being created afterward.
- The local store coordinates writers within one Node process. Do not run multiple independent Next server processes against the same `.ezagent/` directory.

## Rollback

The code can be reverted on this feature branch. Reverting code does not remove `.ezagent/` data or imported sources; retain or review them separately before any cleanup.
