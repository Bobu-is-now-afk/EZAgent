# Judge demo runbook

Status: rehearsal instructions; quotation critical path not yet recorded. Use synthetic values only. Do not enter real customer information.

## Setup check

1. Start the current local quotation build and open its documented local route. Confirm that the screen identifies whether inference is live, simulated, or unavailable.
2. Use the fixed synthetic wording below. Keep the same build, model configuration, and explicit field values for both repeatability runs.
3. If the quotation route is absent, a required service is unavailable, or the page says simulation, stop the quotation run. Record the blocker and switch to the contingency; do not narrate a successful run.

## Critical path

1. Enter exactly: `Create a quote for two workshop days next month.`
2. Inspect provenance markers. The suggested description and quantity can be reviewed; seller, buyer, date, currency, price, and tax must remain visibly unresolved.
3. Attempt to preview while fields are missing. Capture the refusal and list of missing fields.
4. Supply synthetic values: seller `Sample Studio`, buyer `Demo Workshop Co`, valid-until `2026-11-30`, currency `HKD`, unit price `1250.00`, and confirmed tax treatment `No tax`. Review suggested description `Workshop day` and quantity `2` before retaining them.
5. Review the draft and explicitly confirm it. Check subtotal / tax / total of `HKD 2,500.00` / `HKD 0.00` / `HKD 2,500.00`, and that no date or price appeared before user entry.
6. Repeat from a clean draft with the same inputs. Compare the normalized output field-by-field and the integer minor-unit total.
7. Exercise invalid price (`12.345`) and invalid quantity (`0`, then `1.5`). Confirm a useful error, correction, and recovery without clearing unrelated fields.
8. Stop or disconnect the local model service, if available in the test environment. Confirm an honest unavailable/error state, retry after service recovery, and verify that only one quotation is produced.

## Recording fallback

Capture the actual local critical path as one unedited desktop recording, from a clean draft through the completed preview. Include the missing-field refusal, user confirmation, second identical run, and one error/recovery case. Keep application and service status visible where practical. Do not splice, speed up, substitute screenshots, or present a prototype simulation as inference. Keep the original recording and its checksum with the internal rehearsal record; publish only an approved sanitized excerpt.

As of 2026-10-19, no recording of this quotation path is available. The Vercel page listed in the submitted pitch is explicitly an interactive prototype; setup and model download are simulated, and it does not satisfy the recording fallback. Until the local path is runnable, the runbook is the rehearsal storyboard only.

## Contingency

If the quotation path cannot run, state that clearly and show only the prototype disclosure or a prepared static storyboard labeled `not a live run`. Do not claim same-input repeatability, model inference, or successful error recovery. Human usability, clean-install, and offline checks remain pending.
