# Agent Note: Everyday labels and fast local interactions

Status: implemented

## Problem

Technical navigation labels make the settings hard to scan. The expert model form spends three rows on three short choices. Plugin skill switches write invocation controls, but their inventory reads only the legacy disabled flag. Busy feedback can keep a completed operation blocked for a minimum visible duration and a settling delay.

## Decision

- Navigation uses Market, Skills, Shortcuts, Experts, Connectors, and Code intelligence. MCP and LSP remain in service explanations; operating-system commands retain their technical name.
- Expert creation and editing share RoleMetadataFields. Its three controls use a responsive grid; errors and the current model summary span the row. Other fieldsets stay unchanged.
- Plugin skill inventory uses the shared skill parser to read both invocation controls. Commands and experts retain their existing disabled flag and switches. Plugin content and deletion remain protected; experts retain their routing-only editor.
- Busy feedback keeps its 200 ms reveal threshold but has no minimum visible duration or settling hold. Reads remain interactive, including while delayed feedback is visible. Mutations retain immediate repeat-input protection; only visible mutation feedback changes focus and inert state. The final operation lease releases feedback immediately, including on errors.

The loading decision partially supersedes [workspace panels](2026-09-06-workspace-tabs-user-panels.md), which still owns panel composition and document storage. The [routing-only editor](2026-09-26-persona-routing-editor.md) remains authoritative for plugin document permissions.

## Alternatives considered

**Keep the minimum visible duration.** It smooths brief spinner appearances but forces users to wait after their work is complete. Delayed reveal filters short operations without extending completed work.

**Remove every interaction guard.** That permits repeated mutations and closing a save in progress. Existing leases retain write protection while reads avoid the immediate guard.

**Duplicate the creation and editing forms.** Both already edit the same frontmatter through one component; a scoped CSS grid is sufficient.

**Introduce a new toggle store.** Existing writable plugin documents already persist the relevant fields. A separate override store would require runtime and source-update policy changes beyond this correction. External source files and inline JSON resources retain their existing read-only restrictions; source refresh can replace edits in managed checkouts.

## Consequences

No new dependencies, routes, or persisted settings are introduced. A request just over the reveal threshold can still show a brief indicator, but completed work never waits for it. Fake-timer tests cover prompt dismissal, short reads, concurrent leases, errors, and write protection. Panel tests cover all three plugin switch kinds through off, reload, and on, while retaining content and deletion restrictions. Existing GUI verification requires an authenticated browser session.
