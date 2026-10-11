# Tests live beside their packages

Date: 2026-10-11. Class: architecture. Status: implemented.

## Decision

Every vitest suite moves from the central `tests/` tree into the package it exercises, under `packages/<pkg>/test/`. Three placement rules:

- **Single-package suites** sit in that package's `test/`.
- **Cross-package suites** (about 125 of 213) sit in `packages/market-bundle/test/integration/`: the bundle is the composition root, so integration coverage belongs to the composition it assembles. Shared server-side helpers (`fixture`, `bridge-config`, `projected-suite`) and the fixture corpus (`integration/fixtures/`) live there too.
- **Repository-level suites** (scripts, CI gates, repo hygiene) sit in `packages/market-bundle/test/repo/`, except `extension-native-skill-shadow` (runtime-dependent) which lives in `packages/market-runtime/test/repo/`.

The vendored schemas library moves from the root `schemas/` into `packages/market-catalog/schemas/`, because `market-catalog` is its only code consumer. The npm `files` entry keeps shipping it under the same path, so the packed artifact is unchanged. `schemasDirectory()` in `market-catalog/src/scanning/validate.ts` resolves both the workspace layout and the packed layout.

The DOM-only suites keep their own type-check lane via `tsconfig.test.client.json`; suites outside `market-ui` that need jsdom carry an inline `@vitest-environment jsdom` pragma instead of a config exclusion list.

## Alternatives considered

- **Keep the central `tests/` tree.** Rejected: the repository root is the contract layer (see AGENTS.md conventions), and a 300-file central tree hid which package owns which behavior. The root-level `tests/` was the largest remaining non-contract entry in the root listing.
- **Give each workspace package its own vitest config and `pnpm -r` runner.** Rejected: one serial vitest run keeps the shared-fixture serialisation guarantees and the ~2.5s wall time; a per-package runner multiplies processes for no isolation gain.
- **Move fixtures into each consuming package.** Rejected: the fixture corpus is shared by bundle integration suites (15+ files); splitting it would fork the copies the update script writes.

## Consequences

- `vitest.config.ts` includes `packages/*/test/**/*.test.ts`; `pnpm run test:contract` and `scripts/update-layout-fixtures.mjs` point at the new paths; the eslint and dependency-cruiser globs follow the moved tree (cruiser still excludes `/test/`).
- The root drops `tests/` and `schemas/`; the root holds only contract files again.
- `packages/market-catalog/test/schemas.test.ts` guards the library at its new location; `compat-report` scripts read the library through the generator's updated constants.
- Known pre-existing failure, unrelated to this move: `zip-bomb.test.ts` "rejects a zip exceeding the entry-count limit" throws "Maximum call stack size exceeded" on this machine's default stack — reproduced identically on the HEAD baseline worktree before the move.
