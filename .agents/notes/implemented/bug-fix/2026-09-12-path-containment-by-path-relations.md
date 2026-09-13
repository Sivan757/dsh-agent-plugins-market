# Agent Note: path containment compares path relations, not text prefixes

Status: implemented

## Problem

`isWithin(root, candidate)` is the containment guard behind marketplace-entry resolution, declared component paths, archive extraction, and the write guard on plugin resource files. It compared strings: a candidate counted as contained when it started with the root plus the host separator.

That answer is only right when both sides were spelled by the same convention, and on Windows they are not. A checkout path reaches the guard from one of two places: `join()`-based helpers such as `sourceCheckoutDir()`, which produce backslashes, or — for a local source — `expandHome(source.url)`, which returns the configured text unchanged (`C:/Users/x/marketplace` is accepted by the source route, being absolute). `resolve()` then normalizes the entry's own relative path to backslashes, so `C:\Users\x\marketplace\plugins\typescript-lsp` never started with `C:/Users/x/marketplace\`, and every local marketplace entry was rejected as `path "…" escapes the checkout`. Reported against 0.6.2 as issue #50: the official manifest-less LSP plugins are declaration-only, so container fallback scanning cannot rescue them and all twelve disappeared from the catalog.

The same spelling dependence could fail in the other direction: a candidate carrying an unnormalized `..` passed the prefix test, and a legitimate root spelled in a different case did not.

## Decision

Containment asks the platform's own path rules whether the candidate identifies the root or something below it:

```ts
const rel = flavor.relative(root, candidate)
return rel === '' || (!rel.startsWith(`..${flavor.sep}`) && rel !== '..' && !flavor.isAbsolute(rel))
```

`relative` resolves both operands before comparing, so a `C:/x/y` checkout and a `C:\x\y\plugins\a` entry agree, Windows compares drive letters and segments case-insensitively, and a `..` inside the candidate is resolved rather than trusted as text. Production calls `isWithin`, which binds the host's `node:path`; `isWithinUnder` takes the flavor so the win32 rules stay under test on POSIX.

Two hand-rolled copies of the same rule are gone. `storage-migration.ts` had grown its own `contains()` with the win32 branch spelled inline, and `panel-resources.ts` tested `rel.startsWith('../')`, which on Windows never matches the `..\` that `relative()` returns — a resource outside the user root could be rewritten as if it were inside it.

Separator folding settles which text is a path; `realpath` remains the guard against a symlinked escape, so `claimLocal` and `componentPath` still resolve both sides and re-test.

## Consequences

Windows resolves local marketplace entries the way POSIX does, which is what makes the manifest-less LSP plugins installable there.

The rule is stricter than the prefix test for a candidate that still carries `..` (`/a/b/../c` against `/a/b` used to pass and now does not). Every call site resolves its operands first, so this is defense in depth rather than a behavior change, and it is the direction a containment guard should fail.

## Alternatives considered

**Fold separators in the caller.** The reporter's patch normalizes both sides with `split('\\').join('/')`. Backslashes are only separators on the platform where that is true; on POSIX they are ordinary filename characters, so the fold makes `/a/b\c` count as contained under `/a/b` when it is that directory's sibling. `relative` gets the Windows benefit without inventing POSIX containment.

**Adopt the harness's filesystem-identity fallback.** `dsh-fs-sandbox`'s `isPathUnder` keeps a lexical fast path and, when spellings differ, walks the candidate's existing ancestors comparing `dev`/`ino` identity with the root, which also covers Windows 8.3 aliases and casing. Not taken here: our inputs never carry 8.3 aliases (checkouts come from `join`/`resolve`/`realpath`, or from a user typing an ordinary path), and it would make a synchronous predicate used at eight call sites async and I/O-bound. It stays the right tool if an alias-bearing input ever arrives.

**Route containment through `ctx.fs`.** The harness puts containment on the filesystem provider — `contains(parent, child)` over opaque targets from `resolve()` — so consumers never parse paths. Scanning needs `readdir`, recursive walking, git, and archive extraction, none of which the provider contract exposes by design (it is bounded text I/O plus atomic mutations), and `src/catalog/` is deliberately free of harness context so it stays a pure, fast test target.

## Testing

`tests/paths.test.ts` drives `isWithinUnder` with both `path.posix` and `path.win32`. Its first win32 row is the reported shape — root `C:/Users/x/marketplace`, candidate `C:\Users\x\marketplace\plugins\typescript-lsp` — which the prefix rule answers `false`. `tests/scan-pipeline.test.ts` adds the same shape through the real entry handler: a checkout spelled with forward slashes (a no-op on POSIX, the mixed spelling on Windows) must still resolve `./skills/one` as local.

`.github/workflows/windows.yml` runs the suite on `windows-latest`, where the host binds the win32 path functions. The existing `tests/discovery.test.ts` fixture covers the end-to-end regression: `cc-marketplace` declares four string-path entries plus one inline-`lspServers` entry, and under the old rule a Windows run resolved the remote entry and the container fallback only.
