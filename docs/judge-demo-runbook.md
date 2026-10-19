# Judge demo runbook

Status: rehearsal instructions; quotation critical path not yet recorded. Use synthetic values only. Do not enter real customer information.

## Setup check

1. Start the current local quotation build and open its documented local route. Confirm that the screen identifies whether inference is live, simulated, or unavailable.
2. Use the fixed synthetic wording below. Keep the same build and explicit field values for both repeatability runs.
3. The current route is an explicitly labeled concept simulation and makes no model call. That disclosure is expected. If the route is absent or does not state its simulation boundary, stop and record the blocker; do not claim live inference.

## Critical path

1. Enter exactly: `Create a quote for two workshop days next month.`
2. Inspect provenance markers. The suggested description and quantity can be reviewed; seller, buyer, date, currency, price, and tax must remain visibly unresolved.
3. Inspect the incomplete sample preview while fields are missing. Confirm it identifies all missing fields and that explicit review and printing remain disabled.
4. Supply synthetic values: seller `Sample Studio`, buyer `Demo Workshop Co`, valid-until `2026-11-30`, currency `HKD`, unit price `1250.00`, and confirmed tax treatment `No tax`. Review suggested description `Workshop day` and quantity `2` before retaining them.
5. Review the draft and explicitly confirm it. Check subtotal / tax / total of `HKD 2,500.00` / `HKD 0.00` / `HKD 2,500.00`, and that no date or price appeared before user entry.
6. Repeat from a clean draft with the same inputs. Compare the normalized output field-by-field and the integer minor-unit total.
7. Exercise invalid price (`12.345`) and invalid quantity (`0`, then `1.5`). Confirm a useful error, correction, and recovery without clearing unrelated fields.
8. Enter an out-of-range tax rate (`101`), then correct it to `8.25`. Confirm the invalid value blocks review/printing and the corrected value recomputes the tax and total. Model-service failure is outside this path because the quotation concept parser makes no model call.
9. Print the reviewed sample to PDF. Verify the PDF includes the agreed synthetic details and matching totals, check page count, clipping, and blank pages, and record browser/OS, paper size, and print method. Separately refresh after completing a draft and record whether it restores or resets.

## Separate local invoice model evidence (J-05)

This is a separate local workflow. It does not make the quotation parser an AI feature and does not describe the public Vercel site. The fresh replay used repo commit `f2b102a0fe7c027e3cedb28c523407d3d6cbcb7b`, local `/invoice-demo`, and only synthetic input.

Use the goal:

```text
Find invoices strictly above HKD 10,000, flag missing customer names, and export the review results to CSV.
```

Use a five-record CSV with columns `invoice_id,customer,amount,currency,description` and rows: `SYN-101` / 12,500 HKD; `SYN-102` / 9,800 HKD; `SYN-103` / 14,250 HKD with customer blank; `SYN-104` / 21,000 HKD; `SYN-105` / 11,000 USD. All names and descriptions must be fictional. Expected results are `SYN-101`, `SYN-103`, and `SYN-104`; mark `SYN-103` as `missing_customer`; exclude `SYN-102` by threshold and `SYN-105` by currency.

The observed run at this commit returned HTTP 200 for one plan request; the UI showed five ordered steps. The local Ollama process reported `qwen3.5:9b` active during planning. After explicit approval, one Run POST returned 202; deterministic tools completed and exported a CSV with three data rows, eight columns, passed formula-safety checks, and source-row references 2, 4, and 5. The plan preview counted six lines (including the header) for five data records. The code can make one model correction call if its first proposal is invalid; do not manually retry a failed plan. A separate invalid CSV missing `currency` returned HTTP 400 `invalid_request` with generic error copy before model planning; a valid input succeeded in a later session. Same-page correction and Run failure recovery were not tested.

The successful run used one model-backed plan request and one deterministic Run request. Model-call internals were not instrumented. Do not infer inference from the installed model list alone. Do not reuse these results as evidence for the quotation parser, the public Vercel page, a clean install, or fully disconnected operation.

## Five-person usability protocol and results template (J-08)

Status: **not run**. Recruit five first-time, nontechnical participants. Use only the synthetic quotation fixture above; do not collect names, contacts, or other personal data. Run sessions one at a time on the same reviewed build. Give each participant only this task: “Create a quote for two workshop days next month.” Do not explain navigation or field order. Record wrong turns and every moderator prompt; a moderator may repeat the task but must not coach the interface.

After the task, ask without leading: “Was a real document issued or sent?”, “Which values came from the source and which did you enter?”, and “Where do you think your data was processed?” Record whether the participant understands the `SAMPLE` label and missing-field warnings. Do not report a pass until five real sessions are complete.

| Participant ID | Browser | Completed | Time | Wrong turns | Moderator prompts | Incorrect inference | `SAMPLE` understood | Notes |
|---|---|---|---|---|---|---|---|---|
| P1 | pending | pending | pending | pending | pending | pending | pending | pending |
| P2 | pending | pending | pending | pending | pending | pending | pending | pending |
| P3 | pending | pending | pending | pending | pending | pending | pending | pending |
| P4 | pending | pending | pending | pending | pending | pending | pending | pending |
| P5 | pending | pending | pending | pending | pending | pending | pending | pending |

Summary: sessions completed `0/5`; completion rate pending; median time pending; median wrong turns pending; moderator prompt count pending; themes pending.

## Recording fallback

Capture the actual local critical path as one unedited desktop recording, from a clean draft through the completed preview. Include the missing-field refusal, user confirmation, second identical run, and invalid-input recovery. Keep the app's concept-simulation disclosure visible where practical. Do not splice, speed up, substitute screenshots, or present a prototype simulation as model inference. Keep the original recording and its checksum with the internal rehearsal record; publish only an approved sanitized excerpt.

As of 2026-10-19, no recording of this quotation path is available. The Vercel page listed in the submitted pitch is explicitly an interactive prototype; setup and model download are simulated, and it does not satisfy the recording fallback. This runbook is rehearsal guidance, not a screen recording.

No local invoice recording was captured. Playwright's video tool could not start because its required FFmpeg binary is absent. No FFmpeg or other package was installed; the recording gate remains pending.

## Contingency

If the quotation path cannot run, state that clearly and show only the prototype disclosure or a prepared static storyboard labeled `not a live run`. Do not claim same-input repeatability, model inference, or successful error recovery. Human usability, clean-install, and offline checks remain pending.
