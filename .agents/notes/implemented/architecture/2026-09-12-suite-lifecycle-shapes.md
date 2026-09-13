# Agent Note: Two suite shapes — scanned and projected

Status: implemented

## Problem

`Suite` in `src/model/types.ts` described two different things at once.

**Scanned**: what walking a checkout produces (`source-catalog.ts`, `scan-resolvers.ts`, `suite-scanner.ts`, `native-project.ts`). No install state, and no effective surface set — except for `project-native`, whose layout describes the set itself because the machine has no install entry for it.

**Projected**: what `CatalogContext.project()` returns after merging persisted install state. It always assigns `activeSurfaces`, from `effectiveSurfaces(installed?.surfaces)` plus the project-native override plus `lsp: false` for the project dimension.

Because one type covered both, the field had to be optional and eleven consumers that only ever receive projected suites wrote `suite.activeSurfaces?.mcp !== false`. Every one of those conditions is **true when the field is missing**: a suite that reached a runtime consumer without passing through `project()` would have mounted every surface it declares, silently, instead of failing to compile. The optional chain was the only thing standing between a new code path and that default.

## Decision

The scanned shape becomes `DiscoveredSuite`, where `activeSurfaces` is absent unless the layout is self-describing. `Suite extends DiscoveredSuite` re-declares the field as required. `CatalogContext.project()` is the only producer of the second from the first, and it is the only place the two meet:

```ts
export interface DiscoveredSuite {
  /* … */ activeSurfaces?: Record<SuiteSurfaceKey, boolean>
}
export interface Suite extends DiscoveredSuite {
  activeSurfaces: Record<SuiteSurfaceKey, boolean>
}
```

The narrow name is deliberately the projected one. `CONTEXT.md` defines a suite as carrying "an identity, metadata, supported runtime surfaces, and an **installation state**" — so the projected shape is what the domain calls a suite, and scan output is the intermediate it is built from. It also keeps the change where the mistake could be made rather than where it would be discovered: the four scanning producers and `project()` take the new name, and every consumer already said `Suite`, which is exactly the contract they need.

The eleven optional chains become plain property access. **None of the conditions changed** — `=== false` and `!== false` are untouched; only the handling of an absence that cannot occur was removed.

## Alternatives considered

**Introduce `ProjectedSuite` and leave `Suite` as the scanned shape.** The more obvious reading, rejected on two counts. It contradicts the glossary, which puts install state inside the definition of a suite. And it inverts the churn: ~26 consumer files would need their annotations changed instead of 20 producer-side ones, so the change would be largest exactly where it is least interesting.

**A branded or discriminated field** (`kind: 'projected'`) so a consumer could switch on it. Rejected as heavier than the problem: nothing needs to branch on the stage at runtime, and a discriminant invites one.

**Keep the field optional and document when it is present.** This is what the code did, and it is what the eleven chains were: a comment where a type belongs.

## Consequences

**The boundary immediately caught a latent bug.** `tests/real-layouts.test.ts` faked a `Catalog` with `as never` and handed it a _scanned_ suite, which the consumer then read as projected — it now throws at `src/runtime/project-runtime.ts`. That is the silent-mounts-everything failure mode above, and it had been invisible to `tsc` because of the cast. The test projects in the fakes remain, so a cast can still hide this class of mistake; do not read a green typecheck as "no cast hides anything".

**Two synthetic suites needed a truthful set.** `loadUserMcpSuite` and the direct-LSP suite literal are built outside `project()`, so they now carry `effectiveSurfaces(undefined)` — all six surfaces enabled, which is bit-for-bit what the absent field evaluated to at every check that read it.

**One test helper restates a piece of the rule.** `tests/helpers/projected-suite.ts` supplies the default set for tests that drive a consumer straight from a scan, keeping the suite's own enablement. Routing those tests through `project()` instead would have been more faithful but would have recomputed `enabled` from install state — with no install entry it sets `enabled: false`, which breaks the assertions the tests exist for. The helper says so.

**`applyLspOverrides` and `buildLspStatus` keep the projected type**, decided by inspecting their callers rather than by pattern-matching the signature: every caller passes projected suites, and both are shape-preserving maps, so the contract is now enforced rather than assumed.

## Testing

- `Suite` no longer assigns from `DiscoveredSuite` in the other direction: a probe confirmed `const x: Suite = discovered` is TS2322 and `discovered.activeSurfaces.mcp` is TS18048, while `Suite → DiscoveredSuite` still assigns.
- All four typecheck projects, `eslint src tests`, and the dependency-boundary cruise pass.
- `tests/` is 70 files and 506 tests, unchanged.
- Two test sites keep `activeSurfaces?.` on purpose, because their suites come from `discoverNativeProjectSuites` and are the scanned shape.
