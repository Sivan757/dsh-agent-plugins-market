# Settings consolidation architecture

Status: awaiting scope approval; implementation has not started

## Objective

Give every consumer a typed read of effective settings without restating defaults, binding rules or persistence. Cover all six profile settings and the shared workspace resource document. Preserve distinct ownership for browser preferences, credentials, server declarations, favorites and caches. This is a plugin-only refactor: no host changes, profile edits, new dependency, six-panel merge or deployment is authorized by this plan.

## Ownership inventory

| State family | Authority and write path | Decision |
| --- | --- | --- |
| Profile settings: MCP backend, project scanning, region, feedback, source updates, translation | Host ConfigForm / Config volatile references | One contract, one schema owner, one client adapter, one runtime reader |
| Workspace surface switches and entry denials | Existing workspace-hashed resource document | One ResourceFilterService instance owns both; surface API delegates |
| Browser grid/list preference | Existing host snapshot store with browser persistence | Retain useWorkspaceView and its storage key; not a profile setting |
| Locale and theme | Host-owned namespaces/services | Consume their existing adapters; do not copy into market settings |
| Favorites | Existing global favorites document | Retain cross-workspace storage; apply through the workspace owner |
| MCP/LSP overrides and user-authored declarations | Domain services and document stores | Retain their validation and file locations, not scalar preferences |
| Credentials and OAuth grants | Host credential service | Retain secret-specific operations; never copy into a general settings snapshot |
| Startup paths, source seeds and Git acquisition options | Entry Config and catalog construction | Retain restart/construction semantics; not live preferences |
| Install state, translation cache, panel cache and display-only toggles | Existing domain/cache/component owners | Not settings; no migration |

The workspace currently has two memory copies and two serializers for one document. Favorite application performs two writes but only one reconciliation: SurfaceToggleService.applyAll does not invoke the hook. A single-surface update can leave the other in-memory copy stale, and a later entry update can write stale surface choices back.

## Profile settings design

### Shared contract and schema

[contracts/settings.ts](../../../src/contracts/settings.ts) remains dependency-free and owns field types, default values, allowed region values, key lists and resolveMarketSettings. Defaults do not change. Derive mechanical key/type views from this contract rather than introducing a general schema-definition language.

Move MarketSettingsFields and MarketSettingsSchema from the MCP domain to a new application/settings-schema.ts. The module owns schema projection only. Config and ConfigInput derive their six live-setting members from mapped types; the root retains startup-only fields. Keep schema defaults tied to the contract. The existing schema test moves its import, not its expectations.

### Browser read and edit paths

Replace the translation-specific state module with client/settings.ts. Its API is:

```ts
bindMarketSettings(source: ObservableSnapshot<{ value?: unknown }>): () => void
marketSettings.getSnapshot(): Readonly<MarketSettings>
marketSettings.subscribe(listener: () => void): () => void
subscribeMarketSetting<K extends MarketSettingKey>(key: K, listener: () => void): () => void
useMarketSetting<K extends MarketSettingKey>(key: K): MarketSettings[K]
```

The implementation uses the already-declared host createSnapshotStore, synchronous notifications and shallow equality. It publishes a stable read-only snapshot only when effective values change. There is no localStorage, polling, rAF, independent write API or new persisted copy. Reads before binding use the contract defaults. Replacing/unbinding a form disconnects the old source; old disposers cannot clear a newer source, and existing consumers survive re-binding.

The composition root acquires one ConfigForm per served lifetime, shares it with the reader and SettingsFormModel, and returns teardown from the injected child scope. The form retains draft, ready, writable, revision and error state; a fallback effective value must never make an unavailable form writable. Draft edits do not affect runtime readers until the host publishes the saved value.

BilingualToggle uses useMarketSetting('translationEnabled'). The menu reads the same snapshot and subscribes only to that key. Remove translation-enabled.ts and migrate all its imports and tests; do not retain a second alias store. Region choices use one allowed-value declaration, while effective-region preview remains a derived UI concern rather than a second default.

### Runtime reads and reactions

MarketSettingsNamespace exposes getSnapshot() and get(key) for all six settings. A snapshot reads each optional volatile reference once, resolves it through the contract and has no I/O. Missing references work uniformly for every key, not just translation. Existing transport-facing backend/region methods may delegate where a port promises a Promise or needs a derived backend name.

Each loader update takes one snapshot and passes it to the existing reaction methods. Preserve mounting, error logging and retry behavior; do not add change suppression that would prevent a missing host capability from being retried. Initial catalog state and unwired backend/region ports derive defaults from the contract. A standalone localizer's optional enabled callback is an explicit library override, not another profile default; preserve it and test/document the distinction.

## Workspace resource design

ResourceFilterService owns one ResourceFilters snapshot (toggles plus offEntries), one queued mutation path and the existing v2 serializer. It adds currentToggles(), allowsSurface(key) and setSurface(key, enabled). SurfaceToggleService becomes a thin facade constructed with that same owner and contains no state or disk writes.

The composition root constructs one owner, reloads once, wires entry gates and surface gates to it, and calls applyFilters once for favorite/reset. Favorite serialization reads that same snapshot. Existing URLs, request/response shapes, workspace path hashing, field names, global-disabled semantics and explicit reset behavior stay unchanged.

Mutation order inside the owner is: serialize against earlier mutations, derive the full next document from the latest snapshot, persist once, publish once, reconcile once. Failed persistence leaves the old snapshot and skips reconciliation; a failed operation must not poison the queue. If persistence succeeds but reconciliation rejects, retain the committed state and propagate that failure; do not roll memory back while disk contains the new state. A subsequent mutation must still run. Initial reload participates in the same ordering so a late read cannot overwrite a newer mutation. No workspace means in-memory-only behavior, as before. Returned state must not allow callers to mutate the owner's internal arrays or toggles.

Retain v1 reading; new writes use the existing v2 format with both sections. Remove the separate saveSurfaceToggles serializer and migrate its internal callers/tests to the canonical writer. Keep the path helper in a cycle-free location. This change provides one mutation owner per plugin instance; cross-process transactions and external file watching are not added or claimed.

resolveFavoriteInput reuses resolveSurfaceToggles instead of repeating its fallback rule. Entry allow checks remain entry-only; surface gates remain a separate predicate. Do not change inventory display behavior as a side effect.

## Delivery slices and ownership

The native Agent Teams board is the task tracker. Existing tasks/plan.md belongs to an earlier completed initiative and is not overwritten. New implementation tasks link this design and record exact file scopes before claim.

| Slice | Responsibility | Dependency |
| --- | --- | --- |
| Profile foundation | Shared types/region values, neutral schema owner, runtime reader, root Config integration and port defaults | None |
| Browser adapter | Shared six-field reader, consumer migration, settings-form integration and lifecycle tests | Profile API frozen; implementation can proceed with current types |
| Workspace owner | Unified state/service mutations, v1/v2 compatibility and persistence-failure tests | None; no root edits until foundation completes |
| Integration | Root workspace wiring, route compatibility, ownership guard tests and documentation | All owners delivered |

DeepSeek Flash is the preferred implementation route. Lead owns design, task scopes, integration review and final checks. No teammate commits, builds the deployed plugin, changes host files or rewrites unrelated dirty files.

### Approval and assignment gate

The full-scope design includes workspace mutation ownership as well as profile settings. The design question has not received an answer; its timeout is not approval. Automatic goal rounds may review this document but must not start implementation until the scope is confirmed. No implementation task is currently assigned.

After approval, split the delivery slices into these bounded write units. New paths are proposals until their task creates them; existing paths identify the owners to edit rather than overwrite. The shared board records dependencies and precise scopes before any teammate starts writing.

| Unit | Write scope | Required handoff |
| --- | --- | --- |
| Profile declarations | `src/contracts/settings.ts`, new `src/application/settings-schema.ts`, `src/application/mcp/mcp-backend.ts`, `tests/mcp-backend.test.ts`, new `tests/settings-contract.test.ts` | Export names, key lists and mapped input types frozen before consumers migrate |
| Profile runtime | `src/runtime/host/settings-namespace.ts`, `src/index.ts`, `src/application/ports.ts`, `tests/settings-namespace.test.ts` | All-six-key reads and one-snapshot reaction tests; release root entry write scope |
| Client adapter | new `src/client/settings.ts`, retired `src/client/ui/translation-enabled.ts`, `src/client/ui/BilingualToggle.tsx`, `tests/client-translation-settings.test.ts`, `tests/bilingual-toggle.test.ts` | Stable read-only snapshot, selected-key notification and replacement tests |
| Client wiring | `src/client/index.ts`, `src/client/features/settings-card/market-card-form.ts`, `tests/client-plugins-item-views.test.ts`, `tests/client-plugin-card.test.ts` | One served form; saved-value versus draft tests; no remaining retired imports |
| Workspace persistence | `src/application/state/surface-toggles.ts`, `src/application/state/resource-filters.ts`, `src/contracts/resource-window.ts`, `tests/surface-toggles.test.ts`, `tests/resource-window-state.test.ts` | v1 read / v2 write compatibility, one serializer, no import cycle |
| Workspace runtime | `src/runtime/host/resource-filter-service.ts`, `src/runtime/host/surface-toggle-service.ts`, `tests/resource-filter-service.test.ts`, `tests/surface-toggle-routes.test.ts` | One owner, queued writes, persistence/reconciliation failure and isolation tests |
| Root integration | `src/index.ts`, `tests/resource-window-routes.test.ts`, `tests/surface-toggle-gates.test.ts`, `tests/resource-entry-gates.test.ts` | Runs after profile runtime releases the root; routes and gates share the same owner |
| Final guard and documentation | New ownership guard test, test project includes if needed, this design and the existing owning Agent Note pair | Lead checks the final union; no assertions weakened to accommodate unrelated dirty work |

## Acceptance criteria

- All six profile settings pass absent, invalid, explicit-value and live-update tests using the same resolver. Schema defaults and standalone backend/region defaults agree with it.
- A mounted consumer survives late binding, form replacement and unserve; only the selected setting notifies a key subscriber. Unrelated changes do not restart menu work. Child-scope disposal releases source and consumer subscriptions.
- Staged form edits, discard, reset and failed save preserve existing semantics and do not leak draft values into effective settings.
- Surface changes are immediately reflected in the workspace owner and survive later entry edits; favorite save/apply and reset use the same state, one write and one reconciliation per mutation.
- Concurrent surface/entry mutations and reload ordering do not lose updates within the owner. Write failure retains old memory, performs no reconciliation, and a later operation can succeed.
- v1 documents load; v2 writes preserve both sections and the existing path. Separate workspaces remain isolated. No code writes a second workspace document shape.
- No change to translation cancellation/cache behavior, six-panel business composition, user files or credentials.

## Verification

Use the bundled Node and pnpm paths returned by load_workspace_dependencies. Run focused Vitest suites before and after each behavioral change, then the union of client suites, settings/runtime tests, workspace state/service/route tests, and contract tests. Run typecheck, scoped lint/formatting, architecture and reuse gates; attempt check:refactor and report unrelated concurrent failures without editing them. Add a narrow architectural test or existing dependency rule that rejects consumer-side raw form/volatile reads and the retired translation-specific module/second workspace writer. No claimed runtime deployment until an explicit build and existing-GUI verification is scheduled separately.

## Alternatives considered

- A universal storage service: rejected because host forms, secret storage, workspace documents and browser preferences have different ownership, persistence and write contracts.
- Six per-setting adapters: rejected because it repeats default/lifecycle logic and does not satisfy the overall consolidation objective.
- Moving runtime schema into contracts: rejected because contracts must stay dependency-free.
- Rewriting all domain configuration: rejected because server declarations, overrides, caches and startup options are not scalar live preferences; their file semantics are independently owned.

## Risks and boundaries

The working tree contains concurrent changes, including the locale read-performance work. Re-read before editing and preserve unrelated hunks. The shared client snapshot is read-only, not a competing durable store. Runtime getSnapshot remains a fresh in-memory read rather than a new polling cache. Workspace serialization covers one live owner, not arbitrary external writers. Settings ownership improvements are not evidence that the separate idle-CPU problem is fixed.
