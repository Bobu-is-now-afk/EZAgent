# EZAgent

EZAgent explores a guided path from a request to a reviewed AI-assisted document workflow. The [simulated judge demo](https://ezagent-judge-demo.vercel.app/) is a scripted website with fixed fictional responses and synthetic source data. Judges can open the separate [EZAgent Product Web Preview](https://ezagent-product-web-preview.vercel.app/) from its home page. Enter fictional values only in editable fields.

## Hackathon product web preview

The repository-root Next.js app is a separate, interactive product web preview for judges. It shows Chat, Agent Builder, InkVoice, and the Accounting Statement Generator. Free-text Chat uses a live Mac mini model while the temporary gateway is online; suggested answers and agent plans are scripted examples. InkVoice and the accounting tool have editable browser workflows; receipt images use browser OCR and text PDFs use browser text extraction. Session tools reset on reload. Free-text Chat can contact the live model through the server gateway. No background agent or customer system is contacted.

Deploy this app as a **second Vercel project** connected to the same GitHub repository, with Root Directory set to the repository root and Production Branch set to `main`. Keep the existing judge demo project pointed at `demo/`. Verify the second project's public Production URL before linking to it from the judge demo. Run `pnpm exec tsc --noEmit` and `pnpm build` from the repository root before release.

## Judge walkthrough

1. **Preview setup.** The Mac mini M6 profile and `qwen3.5:9b` selection are assumptions for an animation. No hardware is detected and no model is downloaded or installed.
2. **Try Chat and Agent.** Choose a fixed synthetic prompt. Every reply and plan is pre-scripted and labelled as such. The website does not call Gemini, Ollama, or the Mac mini.
3. **Compare one-off work with a reusable tool concept.** The [five-role Markdown spec](demo/agent-team-spec.md) describes one general manager, two mini managers, and two workers. The diagram proposes their responsibilities; it does not create or run agents or save a tool.
4. **Review a document draft.** The [document studio](https://ezagent-judge-demo.vercel.app/documents.html) shows three fixed synthetic records. Only order W-01 enters the quotation. A pre-scripted suggestion identifies source-grounded fields; a person supplies and confirms missing values. Fixed code calculates the total. Rerunning the calculation keeps the same inputs and clears confirmations. The receipt stays blocked without payment proof.

The document preview is always **SAMPLE · DRAFT**. It does not issue, send, number, or request payment for a real document. The other two records are context; this walkthrough does not batch-process them or produce an Excel statement.

## What runs

| Part | Status |
| --- | --- |
| Device check and local-model download | Simulated animation |
| Chat and bounded field/plan suggestions | Fixed fictional scripts; no AI network request |
| Agent team and reusable tool | Proposed structure and workflow preview |
| Quotation arithmetic and review gates | Deterministic browser code on synthetic inputs |

The separate local application prototype uses Ollama `qwen3.5:9b` on a Mac mini; model responses can be slower than this scripted website. The Product Web Preview can contact that Mac mini while its temporary gateway is online; the simulated judge demo does not. The simulated judge demo Vercel project uses [`demo/`](demo/) as its Root Directory. Its former Gemini routes return HTTP 410 and do not read or use `GEMINI_API_KEY`; remove that production environment variable after deployment. The retained adapter code and tests are historical implementation material, not part of the active demo. Run `node --test tests/demo/*.test.mjs` to verify the demo contracts.
