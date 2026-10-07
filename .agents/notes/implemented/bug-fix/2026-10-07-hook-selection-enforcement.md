# Agent Note: Hook authorization follows each published selection

Status: implemented

## Problem

The preset manager publishes individual user and project Hook switches. Parent-only authorization can execute a Hook that the session did not select.

## Decision

The inventory, projection and runtime share one event-and-position identifier. Positions count every command Hook across matcher groups of one event.

Projection retains the original declaration when any individual Hook is selected. The runtime checks both the suite and individual identifier before dispatch. It does not compact the declaration because that would change later identifiers.

Installed market suites have no individual Hook rows in the session inventory. Their Hooks retain the parent-suite selection contract. User and project Hooks require individual selection.

## Alternatives considered

Filter the command arrays before dispatch. Rejected because compacted arrays renumber the remaining Hooks and disconnect them from saved selections.

Require individual selection for every installed suite. Deferred because existing presets contain only parent identifiers for those suites. That change needs matching inventory and migration work.

Replace the host protocol. Rejected because the published protocol already owns shell execution, output decoding and lifecycle records. The plugin only supplies selection authorization.

## Consequences

A visible Hook switch controls execution without changing the host. Declaration positions remain the existing identity format, not a content hash.

The route-level regression preserves an installed-suite positive case and tests the user-Hook negative case. Runtime tests cover matcher groups and out-of-range identifiers.

[The isolated acceptance report](../../../../docs/reference/version-repair-2026-10-07.md) records browser selection, actual shell markers and restart evidence.

## Related

[The preset proposal](../../proposed/feature/2026-10-05-agent-extension-presets.md) retains library, session and migration scope. This note closes its individual-Hook authorization gap without claiming full Hooks compatibility.
