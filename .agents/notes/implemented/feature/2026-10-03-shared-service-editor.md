# Agent Note: Shared service creation and editing

Status: implemented

## Problem

The expert editor's bordered model group, view switch, and document touch because layout spacing is attached to the host content wrapper rather than the actual sibling elements. Service dialogs share field rendering but differ in chrome, identity placement, and policy availability: MCP creation cannot configure the timeouts that editing exposes. A full-width footer hint can also squeeze the create button into two lines.

## Decision

EntryEditorModal owns an explicit vertical stack and document group. The model-to-document gap is 16px and the toolbar-to-editor gap is 8px. Footer actions do not shrink or wrap their labels; explanatory text can wrap.

ServerConfigModal owns the MCP/LSP create and edit shell. Both modes use ServerConfigDetail and ServerConfigEditor, keeping identity, transport, fields, advanced settings, and JSON in the same order. The name is editable only during creation. MCP creation reads its default policy and backend from the existing server-config endpoint with create=true, then submits configuration and policy in one add request. JSON and form edits share a keyed document, including policy; changing the name retains both parts. Invalid or mismatched document identity cannot be silently rebuilt into an empty configuration.

Creation and editing use the same policy parser and host-backend restrictions. A serialized creation validates both parts before writing, saves the policy override, then publishes the declaration through the existing atomic file writer. Publication failure restores the prior override; a failed rollback reports both errors. This is not a cross-file transaction: interruption between writes can leave an unused override, but not a newly published declaration without its requested policy. A subsequent same-name creation replaces stale overrides.

The [workspace panel decision](2026-09-06-workspace-tabs-user-panels.md) continues to own resource storage and composition, and [dialog chrome](../bug-fix/2026-09-29-dialog-chrome-and-mode-switch.md) continues to own host control geometry and fixed editor height. This decision adds service creation policy and explicit sibling spacing without replacing those decisions.

## Alternatives considered

**Change host segmented-control borders.** The controls themselves are correct; their neighboring boxes lack spacing. Local grouping fixes the cause without overriding host internals.

**Reuse only the field component.** Rendering the same component with missing policy data still produces different forms. The shared shell and creation defaults make the inputs and capabilities consistent.

**Add the service, then save its policy in a second browser request.** Failure of the second request leaves a live service with settings the user did not request. Policy-first publication keeps it undiscoverable until both writes complete, using existing stores rather than introducing a transaction layer.

## Consequences

The add API accepts an optional policy; callers that omit it retain their existing contract. No dependency or new storage format is introduced. Read-only resources and host-backend restrictions remain enforced. Unit tests cover parity, JSON/name preservation, validation, defaults, duplicate creation, publication failure, and rollback failure. An isolated DSH web profile with the current linked build verifies real GUI creation and editing: MCP timeouts survive create, reopen, and update; LSP extension mapping and configuration persist. Expert create/edit spacing measures 16px and 8px at desktop and 390px widths, with no horizontal overflow. Cancel/create actions remain single-line. The interaction checks report no browser console warnings or errors; a later idle check records ERR_NETWORK_IO_SUSPENDED and a connection retry. The test commands deliberately do not implement MCP/LSP, so this evidence covers configuration workflows rather than successful protocol handshakes.
