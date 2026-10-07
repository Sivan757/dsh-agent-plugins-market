# Agent Note: Session-owned choices from workspace extension presets

Status: proposed

## Problem

One workspace can contain unrelated frontend, backend and research sessions. Workspace-wide mount switches make those sessions interfere. Users need reusable extension selections without switching the host's base Agent preset or copying credentials between workspaces.

## Proposal

The approved product model separates a workspace-private preset library from detached per-session capability choices. A new-session default is a pointer to a preset, not a live parent for existing sessions. Editing or deleting a preset never changes an existing session's copy. Explicit session changes apply only at a safe execution boundary. Global hard-disabled or uninstalled capabilities remain unavailable.

Blank and ongoing sessions share one 28px icon button to the right of Permissions. The monochrome outline combines an Agent head with a capability connector. The prototype defines behavior and approximate layout, not a separate visual system. The manager uses the current settings page components and styles for tabs, source chips, typography, resource cards, counts and actions. Host Modal supplies the fixed 800×800 viewport-capped frame. Cards toggle the selected preset, and details remain a separate action. Clipboard transfer carries a version, display name and portable resource ids only.

The library uses the existing private JSON writer and published atomic-write lock, with optimistic revisions to reject stale editors. Session choices use supported durable message envelopes with pending and committed checkpoints. Per-agent contributors separate staged registration from committed execution authorization. Live acceptance remains a delivery requirement.

## Alternatives considered

- Native project groups and user Hooks use a separate local-configuration tab. Removing their parent records breaks saved selections and hides hook control. Display metadata separates them from market offerings without changing authorization or persisted ids.

- The previous [project resource window](../../implemented/feature/2026-10-04-project-resource-window.md) and [workspace surface switches](../../implemented/feature/2026-10-03-per-workspace-surface-toggles.md) remain implemented authority until migration lands. Their live workspace mount semantics are only partially superseded; do not archive them while their runtime is active.
- Host base presets are not reused: base mode and extension selection are independent choices. Registering another occupant in the single hero Agent-preset slot would replace the host selector, not append a neighbor.
- Host settings namespaces are config-shaped, not arbitrary workspace libraries. Existing private JSON persistence fits the library; the published atomic-write package provides cross-process local writer coordination. This does not justify a separate Session log: session selection should use a supported durable host envelope.
- An inherited deny mask is not a general override mechanism. Own-scope tools are exempt, global commands cannot be subtracted, and workspace LSP processes are shared. Runtime contributors must enforce the effective session selection without stopping shared resources used by another session.

## Acceptance criteria

- Two sessions in one workspace retain independent choices after preset/default edits; explicit empty selection differs from absent legacy state.
- Clipboard input fails closed; saved presets carry no credentials or service configuration. Concurrent stale writes do not overwrite a newer library.
- The first request cannot run before selection restoration or a acknowledged change finishes. Tool discovery and execution agree.
- First and ongoing entry placement uses supported host composition without replacing base modes or modifying host code.
- Skills, commands, roles, MCP, LSP and suite hooks each have explicit session-scoped behavior and real runtime evidence; unsupported controls must not be presented as effective.
- Full details are reused, user-facing copy is bilingual, and the isolated profile passes browser and runtime acceptance.

## Risks

Published rc.2 provides conversation.input.left as a session-scoped list after the permission/plan controls, not an additive hero neighbor. The user requires an icon in that seat for both blank and ongoing sessions. Genuine no-session drafts have no supported extension metadata handoff. The custom SVG distinguishes Agent extensions from host Agent presets and general settings. The published icon set does not contain this composite. Its stroke uses the published ICON_MEDIUM_STROKE constant and currentColor.

Native user skills reuse the public scoped skill registry: a same-name candidate controls invocation and its provider rechecks the saved selection on load. Ordinary global-off is a default, not a hard availability failure; invalid documents remain denied. Host/foreign MCP tools remain independently managed. Shared MCP and LSP overrides require explicit mount ownership so one session cannot stop another session’s resource.

Helper and integration tests do not establish live delivery. Acceptance must use the built plugin in an isolated profile, exercise both entry states and lifecycle transitions, and distinguish crash recovery from orderly host disposal, which cancels pending input.

The [individual-Hook decision](../../implemented/bug-fix/2026-10-07-hook-selection-enforcement.md) defines enforcement for published user and project Hook rows. Installed market suite Hooks retain parent selection.
