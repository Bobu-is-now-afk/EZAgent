# Dynamic Logic Pills

The Planner workflow may contain `pills: LogicPill[]`. Each pill has a stable
`id`, editable `label`, `type` (`number`, `text`, `tags`, or `select`), typed
`value`, and optional string `options`. The renderer is domain-independent.
Legacy workflows without pills derive controls from step parameters.

## Editing

1. Enter a goal and select a synthetic CSV/TXT source.
2. Create a plan. The returned pills appear in read-only preview mode.
3. Click 修改計畫. Edit values or labels, add typed custom pills, or delete pills.
4. Click 完成修改, then confirm the updated plan and create a Run.
5. Every pill edit invalidates prior approval and the idempotency signature.

Bound IDs (`step:<stepId>:<parameter>`) update existing tool parameters and
matching acceptance criteria. Removing mandatory parameters prevents Run
creation; restore the proposal or replan. The API still validates all tool
parameters and canonical pipeline constraints.

Custom IDs (`custom:<uuid>`) are saved as plan annotations in workflows and
local templates, not interpreted as executable instructions or new tools.
Do not put sensitive data into pills or templates.

## Current execution boundary

The editor supports general-purpose plans, but the current Planner and tool
registry still implement the invoice CSV/TXT pipeline. Clinical and insurance
goals are illustrative UI examples, not newly implemented domain tools.
Threshold values from this adapter use integer minor currency units, indicated
in the generated label. No new package or cloud service was introduced.

## Verification

TypeScript checking, production build, and 44 agent tests passed, including
Planner -> edited pills -> actual Run validation, required-control deletion,
typed values, and metadata serialization. Browser interaction verification was
blocked because the development server did not remain reachable at port 3000
in this tool session; do not treat the automated checks as browser evidence.
