# Judge demo evidence matrix

Evidence status reviewed 2026-10-19. This is a public-safe summary; detailed local rehearsal notes and device inventory are not included.

| Claim / check | Reproduction method | Observed result | Status | Scope / limitation |
|---|---|---|---|---|
| Vercel page is a live quotation demo | Open the URL listed in the submitted pitch and inspect the landing copy; select **Preview setup**. | Landing page says `Interactive prototype` and `Setup and model download are simulated`. The preview says `SIMULATION — no install or download occurs`. | **Verified disclosure; quotation path not tested** — 2026-10-19 | This confirms the page's own simulation notice only. It does not test a quotation or model inference. |
| Prior local invoice demo | Read the existing dated record in [offline-boundary.md](offline-boundary.md). | The record dated 2026-10-10 reports a local invoice plan/run with four output rows, one missing-customer flag, and a CSV download. | **Previously recorded; not rerun in this review** | This evidence is limited to the invoice path. It does not pass any quotation gate. |
| Repeatability for fixed synthetic wording and values | Follow the two-run comparison in [runbook](judge-demo-runbook.md), compare normalized fields and integer minor-unit totals. | Not run: the quotation UI path was not available during this review. | **Pending** | Do not substitute prior invoice-path evidence or a unit test. |
| Missing-field refusal | Leave each required field blank in turn, attempt preview, and record the visible error. | Not run: quotation UI path unavailable. | **Pending** | Acceptance criteria are specified in [judge-demo-acceptance.md](judge-demo-acceptance.md). |
| Bad-input rejection and recovery | Enter malformed price, quantity `0` / `1.5`, and invalid tax rate; correct inputs and continue. | Not run: quotation UI path unavailable. | **Pending** | Needs an actual interactive run; code inspection alone is insufficient. |
| Live-service error and retry | Make the local model endpoint unavailable, observe the error, restore it, retry once, and check for duplicate output. | Not run: quotation UI path unavailable. | **Pending** | Never represent a simulated error state as a live service failure. |
| Actual model and hardware for quotation | Observe runtime identity during a real quote run and record build, date, and test case in the internal test log. | No quotation inference observed. | **Pending** | Model installation and host inventory do not prove that a model served this path. |
| Unedited recording fallback | Capture the run described in [runbook](judge-demo-runbook.md) from clean draft through recovery. | No quotation recording captured. | **Pending** | A storyboard is not a recording. The Vercel simulation does not qualify. |
| First-time-user usability | Run five observed sessions and capture the measures in the acceptance contract. | No participant sessions run. | **Pending** | Do not report a 30-second completion or usability pass without measurements. |
| Clean install and offline | Install on a clean target, complete the task, relaunch, disconnect the network, and repeat. | Not run; packaged quotation build and clean target are unavailable. | **Pending** | Local development behavior does not establish installability or offline operation. |

## Result handling

Update a row only after the stated reproduction method has been run. Record date, build/commit, exact input, expected and actual result, and pass/fail in the internal test log. Keep hardware and runtime inventories out of this public document. Preserve failures and rerun evidence rather than replacing the earlier result.
