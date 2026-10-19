# Proposed agent team — concept simulation

This file and the matching screen describe a proposed team shape only. No agent
is created, dispatched, or run, and no tool is saved or deployed.

| Role | Proposed responsibility |
| --- | --- |
| General manager | Coordinates the proposed workflow and prepares it for human review. |
| Mini-manager: Research | Organizes the synthetic workshop request and research questions. |
| Worker: Analysis | Proposes analysis of the request for human review. |
| Mini-manager: Delivery | Organizes the proposed workshop document and review handoff. |
| Worker: Document | Proposes a document outline for human review. |

The example uses the server-owned synthetic workshop quote fixture represented
by `synthetic_document_task`. The separate document UI is `documents.html` and
uses the `workshop_quote` fixture. The hierarchy is one general manager, two
mini-managers (`Research`, `Delivery`), and two workers (`Analysis`,
`Document`). Every handoff and progress description in the preview is proposed
or simulated. This is not a claim of live orchestration or a general-purpose
agent builder.
