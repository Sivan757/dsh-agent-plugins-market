# Agent Note: Typecheck the test suites in the project that owns them

Status: implemented

## Problem

`tsconfig.json` includes `src/**/*.ts` minus `src/client/**`; `tsconfig.client.json` includes `src/client/**`. Neither mentions `tests/`, so no test file was ever in a TypeScript program. `pnpm run typecheck` passed without reading a single assertion, and the three other ways test code could have been checked were closed too: ESLint runs without `parserOptions.project`, and vitest transpiles without checking.

A test file could therefore name a member that does not exist, pass a property nothing reads, or build a fixture missing required fields, and stay green until someone exercised the branch at runtime. That is not hypothetical. The first project covering `src/**` and `tests/**` reported **48 diagnostics across 22 of the 70 test files**:

- **14 were tests validating something other than what they claimed.** A `MarketService` fake was missing eight interface members (`serverConfig`, `lspStatus`, `lspServers`, `mcpOverrides`, `saveServerConfig`, `addLspServer`, `setLspServers`, `setLspServerEnabled`) — no exercised route called them, so the gap was invisible. A credential resolver was passed as a bare `async () => …` function instead of `{ resolve }`, and a `Map` was passed where `McpSuiteOverrides` (`Record<string, McpSuiteOverrides[number]>`) was declared: `overrides[serverKey]` reads `undefined` off a `Map`, so the stub behaved like `{}` for the wrong reason. Three `McpStatusPayload` fixtures omitted `totals.foreign`, and every `Config` read went through `as Record<string, unknown>`, which tied the reads to nothing.
- **3 were a production type that was wrong.** `tests/scan-pipeline.test.ts` builds `{ source: 'github', repo: 'example/other' }`, and `githubRepoUrl` in `src/catalog/scan-resolvers.ts` reads `record['repo']` — a real Claude Code marketplace shorthand that `MarketplaceEntry.source` did not declare.
- **31 were type noise** with no bearing on what the test proved: `globalThis.IS_REACT_ACT_ENVIRONMENT` under `strict`, a missing default parameter, a `querySelectorAll` without its type argument.

## Decision

Tests are checked by **two** projects that mirror the shipped split, and both run inside the standing gate.

```
tests/  →  tsconfig.test.json         NodeNext · ES2024 · no DOM       53 test files
        →  tsconfig.test.client.json  Bundler  · ES2022 + DOM + jsx    17 test files
```

`package.json`'s `typecheck` script runs all four projects, so `check:refactor` — and therefore the pre-commit hook and the release job — checks tests:

```
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
  && tsc -p tsconfig.test.json --noEmit && tsc -p tsconfig.test.client.json --noEmit
```

**The split is the point, not an artifact of configuration.** A server test that reaches for `document` must fail; it cannot if one project hands every test the DOM lib. The first run proved the boundary earns its keep: `tests/helpers/translate.ts` imports the `Translate` type from `src/client/index.js`, which drags `src/client/**` into any program that includes it. That helper is imported by five client tests and by no server test, so the server project excludes it — and the server program then contains no `src/client` file at all.

**Ownership is fail-closed.** The server project includes `tests/**/*.ts` and excludes the client-owned artifacts by name rather than listing its 53 files. A new server test is checked without being registered anywhere; a new client test lands in the server project and fails on `document` until someone lists it. An explicit include list would have the opposite failure mode — a new test in no project, silently unchecked.

**`tests/globals.d.ts` is the one file both projects read.** It declares `IS_REACT_ACT_ENVIRONMENT`, React's own test flag, once instead of at each of its ten assignment sites. `tests/jsdom.d.ts` is client-only: it declares the `JSDOM` surface the suite constructs (`new JSDOM(html, { url }).window`, that window's `localStorage`, `close()`), because `jsdom` ships no declarations and a types-only dependency was not worth adding to the manifest for one test file.

**One production type was widened.** `MarketplaceEntry.source` gains `repo?: string`, because the runtime reads it and a fixture declares it.

## Alternatives considered

**One project covering `src/**` and `tests/**`.** It is less configuration and finds the same 48 diagnostics — that is how they were found. It lost on the boundary it erases: with the DOM lib in scope for every test, a server test can reach `document` and `window` and still typecheck, and nothing afterwards can tell whether that was intended. Recovering the boundary later means reclassifying 70 files against a program that has been permissive since its first commit.

**Installing `@types/jsdom`.** Defensible — it is types-only and dev-only, and it is what a reader expects to find next to a `jsdom` devDependency. Rejected because the manifest cost outweighs the benefit for one test file: the suite constructs a `JSDOM` instance and reads `window.localStorage`, and the hand-written declaration covers exactly that rather than `any`. A test that reaches for more of the jsdom API fails to compile until the declaration is extended, which is the behaviour a permissive `any` would have removed.

**A separate `typecheck:tests` script.** Cheaper to add and easier to skip. `check:refactor` is the gate that actually runs before a commit and before a tag, and a check outside it is a check nobody runs — the exact failure this change exists to remove.

**Enabling type-aware ESLint now that the projects exist.** `parserOptions.project` would make the lint pass type-aware, which is the other half of the problem statement. It is a separate change: it activates rules the repository has never run, on a tree that has never been checked against them, and folding it in here would bury 48 typed findings under an unrelated rule baseline.

## Consequences

The 48 diagnostics are fixed without `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, or a looser `strict`. Two escape hatches survive, both narrow:

| Hatch                                                    | Where                      | Why                                                                                 |
| -------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `as unknown as Context & { effects: Array<() => void> }` | `tests/mcp-bridge.test.ts` | A fake cordis context carrying only the members `apply` touches; a comment says so. |
| `declare module 'jsdom'`                                 | `tests/jsdom.d.ts`         | Declares the constructed surface, not `any` — see above.                            |

The nine `as Record<string, unknown>` casts in `tests/mcp-config.test.ts` are gone, replaced by `expectTransport` in `tests/helpers/bridge-config.ts`. It is an assertion function, so it is cast-free: it keeps the transport check the cases already made and narrows the config to that variant, which is what ties every field read below it to the bridge's own shape. The same helper served `tests/mcp-overrides.test.ts`, where a mount config had been read as the _manifest_ server type — two different types that share `url` and `headers` and so converted without complaint.

`Simulate` went with it. `react-dom/test-utils` is gone from the two tests that used it, because `@types/react-dom` 19 does not export it against the installed React 18 runtime — and because what it did was not test the DOM. `Simulate.change(node, { target: { value } })` assigns the fake target onto a synthetic event and dispatches that event straight through React's dispatcher; the node's value never changed, React's change detection never ran, and the handler received an object the browser would never produce. `tests/helpers/dom-events.ts` writes through the element's native `value` setter — React's own tracker intercepts the instance property, so a plain assignment makes the following event look like no change — then dispatches the `input`/`change` event React listens for. Breaking the two handlers fails three tests that passed before; the pre-change drive would have caught that too, but nothing else about the DOM path.

The type of `httpConfig()` in `tests/mcp-bridge.test.ts` narrowed from `Config` to `StreamableHttpConfig`. Spreading a union-typed value makes every added property an excess property on the other constituents, which is why two sibling cases already carried `as Config` casts; the helper always built a Streamable-HTTP config and now says so.

`Suite.activeSurfaces` stays optional. It is genuinely absent on a discovered suite and always present on a projected one, which `CatalogContext.project()` guarantees — the tests read it through a narrowing accessor in `tests/surface-toggles.test.ts` rather than the production type being split into discovered and projected shapes. A maintainer revisiting the two-shape question should start here.

## Testing

- `pnpm run typecheck` runs all four projects; `check:refactor` stays the single local gate.
- `tests/` is 70 files and 502 tests before and after; the two new `tests/*.d.ts` files add no tests.
- Every test file is in exactly one project (53 + 17), asserted with `tsc --listFilesOnly`.
- The boundary is asserted from the other side: a probe file using `document` fails under `tsconfig.test.json` and passes under `tsconfig.test.client.json`.
