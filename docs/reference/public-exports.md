# Published export ledger

Every package here has an entry point, and an entry export is a promise to whoever imports it. When nothing imports it, the promise is stale: it keeps a symbol alive through refactors, forces its module to stay loadable, and hides the fact that the feature behind it was removed. Nothing else notices, because a redundant export compiles, lints, and tests green.

The standing rule is that an entry export must have a consumer outside its own package. A package can import its own module directly, so an export only its own code uses is not serving anyone. `pnpm run check:exports` (`scripts/check-dead-exports.mjs`) reads this page and fails the tree when an entry export has no consumer and no row here.

## Parsing conventions

- Rows are the Markdown table lines below. Every other line is commentary.
- Columns: `package` | `export` | `reason`.
- `package` is the directory under `packages/`, written the way the gate reports it (`market-ui`, or `group/market-ui` when packages are grouped).
- `export` is the exported name exactly as the entry spells it, without backticks or a type suffix.
- `reason` states who consumes it and why it cannot live inside the package. A row that says only "public API" is not reviewable; name the caller.

## What the gate checks

- R1 an entry export with no consumer outside its package and no row here fails as `orphan-export`;
- R2 a row naming a package that has no entry point fails as `ledger-unknown-package`;
- R3 a row naming an export that is now consumed again, or no longer exported, fails as `ledger-stale`, so the ledger cannot rot into a suppression list.

## When to add a row

Add one only when the export is deliberately for a consumer this repository cannot see: a host integration reached by name rather than by import, or a published type contract for third-party plugin authors. Say which, and say what would break without it.

## Ledger

| package | export | reason |
| ------- | ------ | ------ |

## Why this page is empty

Fifteen entry exports had no consumer when the gate was written, and every one was a stale promise rather than a hidden contract, so all fifteen were removed instead of recorded:

- `market-bundle` `ConfigInput`, a hand-written duplicate of the `Config` schema's input face that nothing read;
- `market-contracts` `MarketQueries` and `MarketMutations`, exported beside the `MarketService` intersection that already names both;
- `market-runtime` `HOOK_RUN_FAILED`, `HookDryRunOptions`, `OutputStyleState`, `TabLayout`, `USER_OUTPUT_STYLE_DIRECTORY`, `deleteUserStyle`, `hookRunStdin`, `readUserStyles`, `suiteOwnsResourceId` and `userStyleDirectory`, each used only inside its own package;
- `market-ui` `REQUIRED_PRIMITIVES` and `missingPrimitives`, both used only by the entry's own primitive check.

A row is the exception, so an empty table is the healthy state.

Part of `check:refactor`; [the gate map](gate-map.md) lists what every member protects and what none of them can see.
