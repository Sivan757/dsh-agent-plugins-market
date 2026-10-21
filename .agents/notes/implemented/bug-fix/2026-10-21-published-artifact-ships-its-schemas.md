# Agent Note: the published artifact ships the schemas its validator reads

Status: implemented

## Problem

The validator reads its vendored JSON Schemas from disk. `packages/market-catalog/src/scanning/validate.ts:42` walks up from the emitted module to the nearest `package.json` and returns a directory beside it. In the published artifact the module lands at `lib/packages/market-catalog/src/scanning/validate.js`, so the resolver returns `<package root>/packages/market-catalog/schemas` (`validate.ts:60`). The npm `files` list named a root `schemas` directory instead.

That pairing held until 2026-10-11. Commit `eec7ee6` moved the schemas beside their only consumer and taught the resolver the packed path, but left the `files` entry as `schemas`. npm drops a `files` entry that matches nothing and reports nothing. Releases 0.10.0 and 0.11.0 therefore shipped no schema file at all: the 0.11.0 tarball holds 340 paths and none of them contains `schemas`. Every manifest and `mcp.json` validation then threw `ENOENT` on `…/packages/market-catalog/schemas/1.0.0/plugin.schema.json`, deterministically, on every machine. 0.9.2 shipped a root `schemas/` directory of 33 files with the older resolver, which is why only 0.10.0 and later failed.

The consequence is recorded in issue #113 and in the companion note [a terminal extension-session failure degrades the step](./2026-10-21-terminal-extension-session-failure-degrades-the-step.md): the first validation runs inside session capture, so the throw stopped every workspace session from starting.

## Decision

The `files` list names `packages/market-catalog/schemas`, the exact directory the packed resolver computes. npm ships a directory entry recursively, so the tarball carries all 33 vendored files, about 150 KB. The resolver is unchanged: the workspace layout keeps resolving through the catalog package's own `package.json`, and the packed layout keeps resolving through the root one.

A repository test now guards the coupling. `packages/market-bundle/test/repo/published-schemas.test.ts` reads the supported versions out of `SUPPORTED_VERSIONS` in `validate.ts`, requires `<version>/plugin.schema.json` and `<version>/mcp.schema.json` for each of them, and requires each path to be covered by `files` under npm semantics, where a directory entry covers its subtree. A second case reads the resolver's packed branch out of the source and requires its literal to equal the guarded path, so a rename on either side fails the test. Both cases are filesystem-only: no pack, no build, no network.

## Alternatives considered

**Ship the whole `packages/` tree.** It also repairs the missing schemas, at the cost of publishing every private workspace source tree, its tests, and its fixtures in the public artifact. The authoritative copy is the schema library alone.

**Keep the `files` name and copy the schemas to a root `schemas/` directory at build time.** This restores the 0.9.2 shape. It needs a new build step and a second on-disk copy of a set the repository documents as byte-for-byte vendored copies, so the copy can drift from `packages/market-catalog/schemas` without any test noticing.

**Import the schemas as modules and let the bundler inline them.** The spec forbids fetching a schema at load time, not embedding one, so this would satisfy §5.2. It gives up the on-disk library that docs and the compatibility report cite by path, and it needs a JSON import path that `tsc` emits into `lib/` unchanged. The `files` repair is one line and keeps the artifact's layout equal to the checkout's.

**Ship only `1.0.0` and `1.1.0`.** The runtime reads only those two directories. It also drops the dialect and namespace reference contracts from the tarball, and it makes the shipped directory a narrower unit than the one the resolver names, so the guard would have to encode the narrowing. The full library costs about 100 KB more.

**Fetch schemas at load time.** Forbidden by the specification the validator implements (§5.2, §7.2.1): loading a plugin must work offline and must not fetch a schema.

## Testing

The guard fails on the pre-fix manifest and passes after it. I proved the packaged behavior end to end with two real packs from the worktree, `npm pack --ignore-scripts` after `tsc -p tsconfig.json`, and then imported the validator from each extracted tree:

- Pre-fix: 340 paths, 0 containing `schemas`. The extracted validator threw `ENOENT` for the 1.0.0 and 1.1.0 plugin and MCP schemas.
- Post-fix: 374 paths, 33 schema entries. The extracted validator validated a minimal manifest and an `mcp.json` for both spec versions with no error.

`pnpm pack --config.ignore-scripts=true` on the final tree produced the same 374-path set: `diff` of the two path lists printed nothing.

## Consequences

A broken `files` entry can no longer reach a release without failing a repository test. The test proves the file set and the resolver literal, not npm's archive, so a change to npm's `files` semantics or a future glob entry would fail conservatively instead of passing silently.

The published artifact grows by the schema library, and the private workspace packages stay private.

The 0.10.0 and 0.11.0 tarballs stay broken on the registry. A release that ships this decision is the first one that can validate a manifest.
