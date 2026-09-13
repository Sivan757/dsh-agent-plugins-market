# Agent Note: Typecheck the suites, lint them with types, and run the checks where development stops

Status: implemented

## Problem

`tsconfig.json` includes `src/**/*.ts` minus `src/client/**`; `tsconfig.client.json` includes `src/client/**`. Neither mentions `tests/`, so no test file was ever in a TypeScript program. `pnpm run typecheck` passed without reading a single assertion, ESLint ran without type information, and vitest transpiles without checking.

A test could therefore name a member that does not exist, pass a property nothing reads, or build a fixture missing required fields, and stay green until someone exercised the branch at runtime. That is not hypothetical. The first project covering `src/**` and `tests/**` reported **48 diagnostics across 22 of the 70 test files**:

- **14 were tests validating something other than what they claimed.** A `MarketService` fake was missing eight interface members (`serverConfig`, `lspStatus`, `lspServers`, `mcpOverrides`, `saveServerConfig`, `addLspServer`, `setLspServers`, `setLspServerEnabled`) — no exercised route called them, so the gap was invisible. A credential resolver was passed as a bare `async () => …` function instead of `{ resolve }`, and a `Map` was passed where `McpSuiteOverrides` was declared: `overrides[serverKey]` reads `undefined` off a `Map`, so the stub behaved like `{}` for the wrong reason. Four `McpStatusPayload` fixtures omitted `totals.foreign`.
- **3 were a production type that was wrong.** `tests/scan-pipeline.test.ts` builds `{ source: 'github', repo: 'example/other' }`, and `githubRepoUrl` in `src/catalog/scan-resolvers.ts` reads `record['repo']` — a real Claude Code marketplace shorthand that `MarketplaceEntry.source` did not declare.
- **31 were type noise** with no bearing on what the test proved: `globalThis.IS_REACT_ACT_ENVIRONMENT` under `strict`, a missing default parameter, a `querySelectorAll` without its type argument.

The same gap had a second half. A type-aware rule needs to know which program a file belongs to, so with no project covering `tests/` the type-checked ESLint rule set was unavailable — not just for tests, but for `src/` too, since the configuration is shared. Rules that reason about types had never run anywhere.

And nothing ran any of it unless someone remembered to: the entire quality story was a script you had to invoke.

## Decision

**Two projects own the suites, mirroring the shipped split.**

```
tests/  →  tsconfig.test.json         NodeNext · ES2024 · no DOM       53 test files
        →  tsconfig.test.client.json  Bundler  · ES2022 + DOM + jsx    17 test files
```

`package.json`'s `typecheck` runs all four projects. **The split is the point, not an artifact of configuration**: a server test that reaches for `document` must fail, and it cannot if one project hands every test the DOM lib. The first run proved the boundary earns its keep — `tests/helpers/translate.ts` imports the `Translate` type from `src/client/index.js`, which drags `src/client/**` into any program containing it; the helper is imported by five client tests and no server test, so excluding it leaves the server program with no `src/client` file at all.

**Ownership is fail-closed.** The server project includes `tests/**/*.ts` and excludes the client-owned artifacts by name rather than listing its 53 files. A new server test is checked without being registered anywhere; a new client test lands in the server project and fails on `document` until someone lists it. An explicit include list would have the opposite failure mode — a new test in no project, silently unchecked.

**The lint pass is type-aware.** `eslint.config.mjs` points the parser at all four projects and turns on the recommended type-checked set. The four are listed together rather than one at a time because `src/client/**` appears in two of them by necessity: `tsconfig.test.client.json` has to include it so the CSS-module ambient declaration reaches the client test program, and `tsconfig.client.json` owns it for the shipped build. `@typescript-eslint/require-await` is switched off, with the reason at the site: every finding was an `async` implementation of a declared async seam — a port, a provider or a test mock — where `async` is the shape rather than an accident.

**The checks run where development already stops.** `check:quick` is typecheck plus lint, and it is what the surrounding paths invoke:

| Path                      | Runs                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `pnpm run test`           | `pretest` → `check:quick`                                         |
| `pnpm run build`          | `prebuild` → `typecheck`                                          |
| `git commit`              | host alignment, `check:quick`, `format:check`                     |
| `pnpm run check:refactor` | `check:quick`, `format:check`, contract tests, dependency-cruiser |
| release tag (CI)          | `check:refactor`, then the full suite                             |

Testing or building is where a developer already stops; a check that only runs when invoked is the failure this change exists to remove.

## Alternatives considered

**One project covering `src/**` and `tests/**`.** It is less configuration and finds the same 48 diagnostics — that is how they were found. It lost on the boundary it erases: with the DOM lib in scope for every test, a server test can reach `document` and `window` and still typecheck, and nothing afterwards can tell whether that was intended. Recovering the boundary later means reclassifying 70 files against a program that has been permissive since its first commit.

**Installing `@types/jsdom`.** Defensible — types-only and dev-only, and what a reader expects next to a `jsdom` devDependency. Rejected because the manifest cost outweighs the benefit for one test file: the suite constructs a `JSDOM` instance and reads `window.localStorage`, and `tests/jsdom.d.ts` declares exactly that rather than `any`. A test that reaches for more of the jsdom API fails to compile until the declaration is extended, which is the behaviour a permissive `any` would have removed.

**A separate `typecheck:tests` script.** Cheaper to add and easier to skip. `check:refactor` is the gate that runs before a commit and before a tag, and a check outside it is a check nobody runs.

**Landing the type-aware rules as their own change, before fixing what they find.** That was the original sequencing and it did not survive contact: the rules cannot run at all until the test projects exist, and once they do the findings are in the same files. What was kept is the reviewability the sequencing was for — the configuration change is one commit and the 382 fixes are three, grouped by the files they touch.

**`pretest` running the whole `check:refactor`.** Rejected: formatting and the dependency-boundary cruise are slower than the test suite itself and have nothing to do with the loop a developer is in.

## Consequences

The 48 diagnostics are fixed without `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, or a looser `strict`. Two escape hatches survive, both narrow:

| Hatch                                                    | Where                      | Why                                                                                 |
| -------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `as unknown as Context & { effects: Array<() => void> }` | `tests/mcp-bridge.test.ts` | A fake cordis context carrying only the members `apply` touches; a comment says so. |
| `declare module 'jsdom'`                                 | `tests/jsdom.d.ts`         | Declares the constructed surface, not `any` — see above.                            |

Turning the type-aware rules on reported **555 findings across 148 files**; with `require-await` off that is **382 across 75** (77 in `src/`, 305 in the tests). Zero inline disables were added and there were no false positives. The bulk were redundant assertions and untyped fakes; what the rules actually bought:

- **Every mutating route coerced untrusted JSON with `String()`.** `{"url": {"href": "x"}}` registered a source whose url was the literal `"[object Object]"`, and `{"id": {}}` passed the `id === ''` check before reaching the registry. The `typeof` narrowing that came with these rules covered the sites where it changed no behavior; the ones that read a field into stored state are strict now — see [the route field-type decision](../bug-fix/2026-09-12-route-field-types.md).
- **A dropped rejection.** `mounts.get(agent)?.refresh()` in `src/runtime/project-runtime.ts` can reject — its queue body re-reads the project catalog — and the host emits `agent/session-start` without awaiting listeners, so every session start could produce an unhandled rejection. It now logs like its two neighbouring handlers.
- **A test name that claimed a negative it never asserted.** The prompt for the type-checked rules is what made a maintainer read the file closely enough to notice. **Index access returns `T | undefined` in all four projects.** This is what made the hundred-odd non-null assertions the lint pass removed look harmless: `arr[0]` was typed `T`, so `arr[0]!` guarded nothing, and an absent element reached the code as `undefined` with no compiler complaint. Turning the flag on reported **269 sites — 32 in `src/`, 237 in the tests**. `src/` now carries no non-null assertion at all; the tests read every fixture value through a named guard (`tests/helpers/fixture.ts`) so a wrong fixture fails saying what it expected. No fixture turned out to be broken — every guard holds — so what the flag exposed was unproven assumptions rather than live defects. The one place a missing value used to be absorbed silently instead of failing is a CSS-class lookup in the legacy page mode; it now warns and assigns no class rather than the literal string "undefined".

- **The flag does not reach assertions on optional properties.** `suite.mcp!.servers` on an `mcp?:` field is a different class from `arr[0]!`, and twelve sites of it survived the conversion in `src/`. Each went away by making the guarantee structural rather than asserted — hoisting the value into a `const`, since the narrowing of a parameter's property is discarded inside a callback, or narrowing the producing function's return type. `src/` is free of `!` because of what the code holds, not because the flag checked for it.

- **Four more names that claimed more than their tests asserted.** Reading the files for the rules above surfaced these; each is now either backed by an assertion or renamed to what holds. `lsp-mounts` promised "removes an existing mount" while only counting applies — and the shared `disposed` boolean it would have reached for is also set by the capability seam, so it could never have separated the provider mount from the seam; it now records the config each handle is disposed with, and fails when the provider's disposer is dropped. `mcp-mounts` said "disabled or uninstalled" for a case whose two branches both called `reconcile([])`, mutating an `enabled` flag nothing on that path reads; it now covers the decision the registry does own — a suite still listed with `activeSurfaces.hooks` off loses its bridge. `mcp-config` said "two sources never collide" while asserting the opposite for the server name, which is source-independent by design so the registry can skip the duplicate; only the registry key and the `PLUGIN_DATA` dir are per-source. `real-layouts` paired the detail's command count with the suite's own resource list — the builder against its input, and `0 === 0` for the dialects that declare no commands; the rows are now named, their content must be non-empty, and every declared path must exist in the fixture snapshot.

`Simulate` went with the test fixes. `react-dom/test-utils` is gone from the two tests that used it, because `@types/react-dom` 19 does not export it against the installed React 18 runtime — and because what it did was not test the DOM. `Simulate.change(node, { target: { value } })` assigns the fake target onto a synthetic event and dispatches that event straight through React's dispatcher; the node's value never changed, React's change detection never ran, and the handler received an object the browser would never produce. `tests/helpers/dom-events.ts` writes through the element's native `value` setter — React's own tracker intercepts the instance property, so a plain assignment makes the following event look like no change — then dispatches the `input`/`change` event React listens for. Breaking the two handlers fails three tests that passed before.

Two typing patterns are worth knowing, because they recur:

- Vitest 4 types `expect.objectContaining` / `arrayContaining` / `stringContaining` / `any` as returning `any`, so `no-unsafe-assignment` reports them wherever they are _assigned_ — a matcher in argument position is fine. The fix is to move the matcher into argument position (`toHaveProperty(path, expect.anything())`), not to cast it; hoisting it to a `const` and `satisfies` both still report.
- `no-base-to-string` does not fire on bare `unknown`; it fires once a guard (`?? ''`, `!== undefined`) narrows `unknown` to `{}`. Cast-free fixes therefore need real `typeof` narrowing or a helper whose parameter is genuinely `unknown`.

The projection boundary this note used to defer (`Suite.activeSurfaces` optional) is now its own type — see [the suite lifecycle decision](../architecture/2026-09-12-suite-lifecycle-shapes.md).

## Testing

- `pnpm run typecheck` runs all four projects; `check:quick` and `check:refactor` are the two gates. All four set `noUncheckedIndexedAccess`, so indexing is `T | undefined` on both sides of the shipped/test line.
- `tests/` is 70 files and 506 tests before and after the lint fixes.
- Every test file is in exactly one project (53 + 17), asserted with `tsc --listFilesOnly`.
- The boundary is asserted from the other side: a probe file using `document` fails under `tsconfig.test.json` and passes under `tsconfig.test.client.json`.
- The gate itself was falsified: deleting `foreign` from an `McpStatusPayload` fixture makes `pnpm run typecheck` exit 2.
