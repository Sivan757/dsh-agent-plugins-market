# Agent Note: Configuration parent ids never persist

Status: implemented

## Problem

Extension presets carried invisible configuration-parent resource ids. The user hooks configuration (`market:@user-hooks/user-hooks`) and every project native layout suite (`market:native/<dir>-native`) publish no card anywhere: the resource list filters rows carrying a `configuration` classification. But selecting any of their children wrote the parent id into the selection, and the capture paths wrote it too — `initialSelection` collected every row that was available and not globally off, and the configuration parents passed that filter. A user who never touched a project resource still carried `market:native/*` in every new session's default selection, and copying a preset shipped the id to another workspace.

## Decision

A parent id a card cannot render never persists. The contract now enumerates the configuration parent ids (`CONFIGURATION_PARENT_IDS`) and strips them at every persistence point: `captureExtensionSelection`, the preset store's create and update, and both preset transfer directions. A copied preset and a pasted one carry child ids only; legacy data that still carries an explicit parent id stays readable and drops out at the next save or copy.

The runtime derives each configuration parent's grant from its selected children instead:

- `extensionResourceEnabled` grants a configuration parent row when any child it owns is selected, and grants a child of a configuration parent on the child's own id alone.
- `projectExtensionSuites` admits a suite through `suiteOwnsResourceId`, which accepts the explicit parent id or any owned child id; the `@user-mcp` runtime derivation in `session-extension.ts` remains and now has a sibling rule rather than being the only one.
- `ExtensionRuntime.selected` derives the grant for a configuration parent id that publishes no row at all — the path the hooks bridge and the mount filter take when they address the suite by its bare suite id.
- The inventory no longer publishes the `@user-hooks` market row in either the candidate or the legacy loop, mirroring what `@user-mcp` already did.
- The client's `toggleResource` stops writing the parent id, `resourceSelected` reads a configuration child on its own id, and the manager's draft seed matches the server capture.

Capture keeps one subtlety: `initialSelection`'s guard set must still contain the parent ids, because a child only survives capture when the set shows its parent. Only the published selection strips them.

## Alternatives considered

- **Stop publishing the configuration parent rows entirely** (the "thorough" shape): the `parents` availability map and the owner labels still consume those rows, and the derivation logic is needed for legacy data either way, so the smaller cut keeps the rows as internal bookkeeping.
- **Tighten the `ENTRY_ID` grammar** to reject configuration parent ids on write: whether an id is a configuration parent is data-dependent, not a lexical property, and the grammar stays the compatibility boundary for legacy reads.
- **Migrate old presets and session snapshots once**: the runtime accepts both spellings, and an id a copy or save drops needs no migration pass.

## Consequences

A preset, a copy, and a new session's captured selection contain only ids a card somewhere can render. The cost is a second grant shape to reason about: authorization, projection, and the runtime gate each derive configuration parents from children, and the hooks bridge consults the derived form. Suite-level "on with nothing selected" has no meaning for configuration suites — an empty projection mounts nothing, which matches the previous behaviour of an invisible parent nobody could switch alone.

## Testing

`tests/extension-configuration-parents.test.ts` pins the id enumeration, the transfer and capture strips, both derived-grant shapes, the unchanged real-suite contract, and child-only projection. `tests/extension-suite-inventory.test.ts` now asserts the hooks suite publishes no market row, granted or rejected. The scoped-effects acceptance still runs a granted user hook through the public routes with child ids only.
