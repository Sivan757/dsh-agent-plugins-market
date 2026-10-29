# Unreachable modules

Every module under `packages/<name>/src` should be reachable from a package entry by following imports. A module nothing imports still compiles, lints and tests exactly like live code, so it survives refactors; the tab-row component a new rail replaced was 156 such lines, and no other gate here could see it.

`pnpm run check:modules` (`scripts/check-module-reachability.mjs`) walks every import from the eight package entries, dynamic imports included, and fails the tree when a module is never reached and this page does not record why.

## Parsing conventions

- Rows are the Markdown table lines below. Every other line is commentary.
- Columns: `module` | `reason`.
- `module` is the repository-relative path the gate prints, with forward slashes.
- `reason` names who reads the module today. "Kept for later" is not a reason; a named importer is.

## What the gate checks

- R1 a module nothing reaches, with no row here, fails as `unreachable-module`;
- R2 a row whose module has become reachable again fails as `ledger-stale`, so this cannot stay a suppression list.

## When to add a row

Two cases, and only two. A module the walk cannot follow, such as a file the host loads by path rather than by import. Or a module whose only reader is a test, where the test is the record that the behaviour is still expected and deleting either half is a decision rather than cleanup.

## Ledger

| module | reason |
| --- | --- |
| `packages/market-bundle/src/application/server-config.ts` | Read only by `test/integration/server-config.test.ts`. The route path stopped importing it; the wired behaviour lives in the server-config route group. |
| `packages/market-runtime/src/application/state/surface-toggles.ts` | Read only by `resource-window-state.test.ts` and `surface-toggles.test.ts`. The runtime keeps surface state through the host settings document instead. |

## Why two are recorded instead of deleted

Both are still covered by a passing test. Deleting them retires behaviour a test asserts, which is a decision rather than an audit cleanup. The resource-window surface that shared this page was retired on request: its four files, its integration test and 74 locale lines are gone, so the rows for it are gone too.

Part of `check:refactor`; [the gate map](gate-map.md) lists what every member protects and what none of them can see.
