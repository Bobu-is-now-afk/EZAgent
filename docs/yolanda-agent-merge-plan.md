# Yolanda + invoice Agent integration — 2026-10-10

Chosen strategy: B, Yolanda shell with additive restoration of the executable invoice Agent.

- Base: latest fetched origin/Yolanda_v1; feature branch codex/yolanda-friction-reduce.
- Source: worker-a/t1-inspection. Restore app/api/agent, app/api/chat, lib/agent,
  components/agent, data/demo, tests/agent and their contract/demo/offline documentation.
- Keep Yolanda builder/review routes and libraries intact. Restore the former Main Stage
  UI in components/agent/agent-workspace.tsx and expose /invoice-demo and /chat.
  Home links to the real paths; builder remains a separately labelled design/preview surface.
- No blind merge, removal of Agent functionality, fake preset launch, commit or push.
- Local AI preparation uses the existing manifest and Python bootstrap. Readiness must
  be read-only; preparation explicitly discloses downloads, never executes remote scripts,
  and requires same-origin loopback requests. Runtime chat/planner use the selected config.
- Preserve existing untracked handoff/audit/bootstrap/manifest and unrelated user files.

Design thinking: users do not know paths or terminals → first success is preparing AI,
loading bundled synthetic invoices, approving the plan and downloading CSV → provide
Home setup card, hardware-gated choices, sample button and expandable technical details.

Validation: Python missing-engine/model/low-resource tests; TypeScript and production
build; restored Agent and Yolanda suites; browser first-run/demo tests where available.
No real model installation/download during automated tests. Full desktop packaging and
PDF/XLSX support remain outside scope. Rollback: restore modified tracked files from the
base and remove only this change's added files after review; retain .ezagent user data.
