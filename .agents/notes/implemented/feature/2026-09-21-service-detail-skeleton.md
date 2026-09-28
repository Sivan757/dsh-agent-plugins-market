# Agent Note: The service detail reads as a record

Status: implemented

Revised by [a failure report that leads with the cause](2026-09-24-failure-report-with-cause-chain.md): the state line now leads with a sentence for the classified failure shape and keeps the recorded diagnostic behind a disclosure.

## Problem

The MCP service dialog opened on its configuration form: one column of inputs filled the scroll area, the tool list sat at the bottom, and the failure reason was a block between them. Configuration is the least frequent task, so the two things a user opens the dialog for — whether the server works and what it offers — were the last thing on screen.

## Decision

Both service dialogs share one order: identity band (state dot, name, status, source, transport, endpoint or command), one state line carrying the reason and the single recovery action it implies, the capability area, the credential rows, the collapsed connection definition, the advanced disclosure, and the action bar.

- The tool list renders the first eight rows, offers a name filter once a server publishes more than eight, and expands to the full list on demand. A denied tool stays listed so it can be switched back on.
- Reporting and changing live in separate dialogs: the card carries the edit action, just before its enable switch, into the same dialog the add flow uses, and the detail dialog only reports — state, capabilities, credentials. The state rail on a card's leading edge carries the state, so no written label repeats it.
- The transport is a segmented control, and each option states which fields it configures.
- The enable switch sits at the trailing edge of the action bar.
- A new service asks for the name, the transport and the one field that transport needs; the optional connection inputs and the timeouts stay in the disclosure. A template list and a paste box fill the form from a known service or from a definition copied out of another client's configuration file.

## Alternatives considered

- **Keep one flat form and reorder its blocks.** Rejected: the form is the slowest task in the dialog, and giving it the top of the scroll area is what made the record unreadable.
- **Paginate the tool list.** Rejected: a page control hides how many tools a server offers; a count with in-place expansion keeps that visible.
- **Split the MCP and LSP dialogs.** Rejected: they answer the same questions with different fields, so one skeleton keeps the two learnable together.

## Consequences

- The dialog order becomes the reference for later service surfaces; a new block picks its rung on this ladder instead of appending to the bottom.
- New styling stays on the platform tokens; the additions are a block subtitle, the derived-value line in a disclosure summary, and the tool row grid.

## Testing

`tests/client-mcp-detail.test.ts` pins the order (capability area above the connection definition), the single enable switch, and the tool truncation, search and expand paths. `tests/client-server-config-policy.test.ts` and `tests/client-detail-editors.test.ts` open the collapsed connection definition before editing, which is the path the dialog now requires.

## Related

- [MCP user policy rides the override record](./2026-09-21-mcp-user-policy-in-overrides.md) — what the advanced disclosure holds.
- [Detail rows and document bodies](./2026-09-16-detail-row-and-document-body.md) — the disclosure shape this reuses.
