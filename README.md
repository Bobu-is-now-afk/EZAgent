# EZAgent

EZAgent explores a guided path from a request to a reviewed AI-assisted document workflow. The [judge demo](https://ezagent-judge-demo.vercel.app/) ships with fixed synthetic source data so each step can be inspected safely. Enter fictional values only in editable fields.

## Judge walkthrough

1. **Preview setup.** The Mac mini M6 profile and `qwen3.5:9b` selection are assumptions for an animation. No hardware is detected and no model is downloaded or installed.
2. **Try Chat and Agent.** Choose a fixed synthetic prompt. A reply is marked **Live · Gemini** only after the server returns a successful Gemini response. Otherwise the page shows a labelled sample or an explicit error. Gemini is a cloud service; this demo does not present it as local Qwen inference.
3. **Compare one-off work with a reusable tool concept.** The [five-role Markdown spec](demo/agent-team-spec.md) describes one general manager, two mini managers, and two workers. The diagram proposes their responsibilities; it does not create or run agents or save a tool.
4. **Review a document draft.** The [document studio](https://ezagent-judge-demo.vercel.app/documents.html) shows three fixed synthetic records. Only order W-01 enters the quotation. Gemini can suggest source-grounded fields when configured; a person supplies and confirms missing values. Fixed code calculates the total. Rerunning the calculation keeps the same inputs and clears confirmations. The receipt stays blocked without payment proof.

The document preview is always **SAMPLE · DRAFT**. It does not issue, send, number, or request payment for a real document. The other two records are context; this walkthrough does not batch-process them or produce an Excel statement.

## What runs

| Part | Status |
| --- | --- |
| Device check and local-model download | Simulated animation |
| Chat and bounded field/plan suggestions | Cloud Gemini only when the server-side adapter is configured and a request succeeds; otherwise labelled sample or error |
| Agent team and reusable tool | Proposed structure and workflow preview |
| Quotation arithmetic and review gates | Deterministic browser code on synthetic inputs |

The public Vercel project uses [`demo/`](demo/) as its Root Directory. The repository also contains a separate application prototype; its branches and pull requests are not automatically part of the judge site. The Gemini key is read only by server functions and is never placed in browser code. See [adapter details](docs/demo-gemini.md) and run its mock tests with `node --test tests/demo/gemini.test.mjs`.
