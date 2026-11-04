# Architecture audit: dsh-agent-plugins-market

Read-only audit at dev head 3853273. Eight private packages behind one published artifact. Method: read the host's intended layering in deepseek-harness docs/architecture.md and its placement rules, then read packages/*/src of this repo. `pnpm run check:architecture` passed (299 modules, 1123 dependencies, no violations) and is treated as a floor. Findings are ranked by the cost of NOT fixing them.

`check:architecture` cannot see any finding below. Every one is a boundary the import graph permits.

---

## 1. Two producers register the same system prompt section name

**Severity: should-fix. Highest cost if left.**

**Responsibility split: "contribute suite instruction text to the prompt".**

| Owner | Location                                                                                             | Live?                                       |
| ----- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| A     | `packages/market-runtime/src/runtime/host/scoped-contributors.ts:189-196`                            | yes, registered inside `agent.ctx.inject()` |
| B     | `packages/market-runtime/src/runtime/surfaces/project-runtime.ts:83` inside `mountSuiteInstructions` | no production caller                        |

Both register `name: 'agent-plugins:instructions', order: 500, interpolate: false`. Both carry the same comment about `{{cwd}}` breaking prompt assembly.

Why it hurts a future change. The host's prompt service is keyed by section name. If anyone wires B into a profile, two sections with one name and one order mount without complaint, and the model receives the suite instructions twice. The dead path is also the one the tests exercise: `packages/market-bundle/test/integration/real-layouts.test.ts:205` calls `mountSuiteInstructions` and asserts the text it produces. So the suite blesses a shape production never uses and cannot catch a divergence in the live one.

Smallest repair. Delete `mountSuiteInstructions`, `mountProjectSurface`, `ProjectRegistry` and `ProjectAgent`. Rewrite `real-layouts.test.ts` to cover `suiteInstructions` directly, which is what the live producer calls at scoped-contributors.ts:250 and `:256`. One producer, one test.

---

## 2. project-runtime.ts: four of six exports have no production caller

**Severity: should-fix.**

**Responsibility misplaced: the file is named for a runtime mount, and its body is a dead mount framework.**

Measured references across `packages/*/src`, excluding the defining file:

| Export                           | Production references |
| -------------------------------- | --------------------- |
| `mountProjectCommands` line 26   | 0                     |
| `mountProjectMcp` line 37        | 0                     |
| `mountProjectHooks` line 59      | 0                     |
| `mountSuiteInstructions` line 64 | 0                     |
| `suiteInstructions` line 113     | 3                     |

`mountProjectSurface` (line 153) is called only by those four, so 234 lines exist to serve nothing. `mountProjectHooks` is referenced by no file at all, tests included.

Why it hurts a future change. A maintainer reading project-runtime.ts sees a supported project-surface mount path for commands, MCP, hooks and instructions. It is not supported: the live project surfaces mount elsewhere. Every refactor of `CommandMountRegistry`, `HooksMountRegistry` or `McpMountPort` has a fake caller that must keep compiling, and every hour spent understanding this file before editing it is lost.

Smallest repair. Move `suiteInstructions` and `SuiteInstructionPaths` into a module named for them, and delete the rest of the file.

---

## 3. Two owners of "where is the project root"

**Severity: should-fix.**

**Responsibility split: the .git climb.**

| Owner | Location                                                     | Shape                                                                |
| ----- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| A     | `packages/market-catalog/src/scanning/paths.ts:72-80`        | `findProjectRoot(cwd)`, synchronous `existsSync`, hardcoded `'.git'` |
| B     | `packages/market-bundle/src/application/instructions.ts:167` | `projectRootOf(cwd, markers)`, asynchronous, parameterised           |
| Host  | `packages/context/agent-instructions/src/files.ts:232-247`   | `findProjectRoot`, not re-exported from the package barrel           |

The header at instructions.ts:13-18 records that B mirrors the host because the host does not export the rule from its barrel. That is honest and it also states the hazard: the mirror is a second implementation of a rule the model's prompt depends on.

Why it hurts a future change. The host adds a marker or changes the climb. The instructions page keeps reporting the old chain, and the page's whole promise is that it matches what the model received. A owns a third copy with a different concurrency model, so the next maintainer must decide which is authoritative before touching either.

Smallest repair. Delete A and have its callers use B. One function owns the climb, and it is the one that already documents the divergence risk.

---

## 4. resolveAgentsRoot reimplements a host resolver its sibling delegates to

**Severity: should-fix.**

**Responsibility split: the `$DSH_AGENTS_HOME` rule.**

`packages/market-catalog/src/scanning/paths.ts:44` delegates:

```ts
export function resolveDshHome(): string {
  return resolveHarnessHome()
}
```

`packages/market-catalog/src/scanning/paths.ts:57-60` hand-rolls the sibling rule:

```ts
export function resolveAgentsRoot(): string {
  const configured = process.env.DSH_AGENTS_HOME
  return configured === undefined || configured.trim().length === 0 ? join(homedir(), '.agents') : resolve(expandHome(configured))
}
```

The host exports the exact counterpart at `packages/util/home-paths/src/index.ts:151` (`resolveAgentsHome`) and its display form at `:195` (`agentsHomeDisplay`). This repo already depends on `@deepseek-ai/dsh-home-paths` and imports it in two source files, so the dependency is not the obstacle.

Why it hurts a future change. The host changes the blank-override rule, the tilde expansion, or the default directory. `resolveDshHome` follows for free and `resolveAgentsRoot` does not, and the agents root decides which suites, skills and hooks a session sees. `market-bundle/src/application/instructions.ts:24` then reads `dshHomeDisplay` from the host while taking the agents root from the local copy, so one file disagrees with itself across the rename.

Smallest repair. Return `resolveAgentsHome()` from the host package.

---

## 5. The instruction byte budget is declared twice, once per side of the wire

**Severity: should-fix.**

**Responsibility split: the rendered baseline cap and the per-file source cap.**

Plugin side: `packages/market-bundle/src/index.ts:139` (`instructionMaxBytes`) and `:145` (`instructionMaxSourceBytes`), resolved at `application/instructions.ts:69-73` against local defaults at `:39` (65536) and `:42` (1048576).

Host side: the same two caps as the `dsh-agent-instructions` row's `maxBytes` and `maxSourceBytes` (`packages/context/agent-instructions/src/config.ts:22` and `:24`).

The JSDoc on both plugin fields tells the reader to keep them equal to the host row (`index.ts:132-145`). Nothing reads the host row.

Why it hurts a future change. A user raises the host row's `maxBytes`. The page keeps reporting the 65536 default and the doc comment gives no signal that the model now sees something else. This is the one duplicated value that falsifies the product claim rather than merely costing maintenance, because the page exists to report what the model received.

Smallest repair. Drop the two plugin fields. If the host resolved value is not exposed, replace them with display-only constants clearly labelled as unable to track the host, and delete the "keep equal" instruction from the JSDoc because nothing enforces it.

---

## 6. extension-hooks.ts has passed one responsibility

**Severity: nice-to-have.**

**Responsibility grown past the file name.**

964 lines, one class. It owns the ten-point event list (`:40`), five host listener registrations, the decision mappers (`blockReason` `:755`, `halt` `:774`, `contextFrom`), the SessionEnd disposal pass (`sessionEnd` `:540`), subagent observation (`observeSubagent` `:555`), detached-run tracking (`track` `:590`), the reference-compat notices (`compatNotices` `:222`, `noticeFallback` `:712`), and the suite and hook authorization gate.

Why it hurts a future change. Every hook-semantics change touches one file, so two concurrent hook changes conflict by default. The class cannot be exercised below its listener surface, which is why the hook suite builds a fake host shell.

Smallest repair, not urgent. Extract the decision mappers into a pure module that takes a merged outcome and returns text, leaving `ExtensionHooks` with listeners and lifecycle only. That step is mechanical and introduces no new abstraction.

---

## 7. Fifteen test-only and three orphan exports beyond project-runtime

**Severity: nice-to-have.**

No production reference, referenced only by tests: `MarketSettingsSchema`, `selectionAllows`, `addUserMcpServer`, `parseTimeoutPatch`, `supportsMcpSessionControl`, `serializeFrontmatter`, `saveSurfaceToggles`, `SEAM_ADAPTERS`, `defer`, the three project-runtime mounts, `isTripped`, `fetchUserPanel`, `ComposerResourceEntry`.

Referenced by nothing at all: `mergeTranslationFields` (`market-contracts/src/contracts/translation.ts:84`), `mountProjectHooks`, `isWritable` (`market-ui/src/features/instructions/instructions-view-model.ts:81`).

Why it hurts a future change. Each is a public-looking surface a maintainer must keep compiling or rename, and each test that covers one proves behaviour nothing produces. `isWritable` returning `row.exists` is an invitation to build a permission concept the product does not have.

Smallest repair. Delete the three orphans. For the test-only ones, either give them a production caller in the same change or drop the export and test the behaviour through the caller.

---

## 8. SEAM_ADAPTERS is an abstraction kept alive by its own contract test

**Severity: nice-to-have.**

`packages/market-runtime/src/runtime/agents/subagent-seam.ts:240` exports a four-entry adapter table whose only reader is `packages/market-runtime/test/host-seam-contract.test.ts:42`, which asserts each entry is a function. The production path calls `startOneShotChild` and its siblings directly.

Why it hurts a future change. The table exists for a test's convenience, so a fourth caller cannot use it because it is wired to nothing. A maintainer who adds a `SeamOperation` must satisfy a test that guards a map no product reads.

Smallest repair. Delete `SEAM_ADAPTERS` and have the contract test import the four functions it names.

---

## 9. Ninety-four cross-package imports reach past the exports maps

**Severity: nice-to-have. Legal today, unguarded tomorrow.**

Measured: 146 relative imports escape into a sibling package. 52 target `src/index.js`, the legal barrel. 94 go deeper, and all 94 target `market-contracts`, whose exports map does publish those subpaths (`"./contracts/*"`, `"./model/*"`, `"./ports/*"`, `"./host/*"`, `"./redaction"`).

No import is illegal today. The hazard is the mechanism. The other seven packages export only `"."`, and their barrels are reached by relative path rather than by `@dsh-market/runtime`, so the `exports` map is decorative and only dependency-cruiser stands between a file and a sibling's internals. The first import of a non-exported internal file will read exactly like the 146 legal ones.

Why it hurts a future change. These packages are private, so no publish pressure keeps the boundary honest, and review will not catch the first violation.

Smallest repair. Add one dependency-cruiser or lint rule requiring `@dsh-market/*` specifiers for cross-package imports, then let the auto-fix rewrite the 146 sites.

---

## 10. Reimplementation is the pattern only where the host exports from an internal module

**Severity: nice-to-have. It is the theme behind findings 3, 4 and 5.**

The repository is generally disciplined about riding host capability: it imports `dsh-home-paths`, `dsh-atomic-write` and `dsh-agent-instructions`, and the MCP bridge offers the host's `dsh-mcp-client` as a selectable backend (`market-mcp/src/runtime/mcp/mcp-mounts.ts:378`). The exceptions share one shape: the host exports a rule from an internal module but not from the package barrel, so the plugin mirrors it and records the mirror in a comment.

- `findProjectRoot`: exported at `packages/context/agent-instructions/src/files.ts:232`, absent from that package's `lib/types/index.d.ts`.
- The marker list and the reserved scope names: same file, same gap, mirrored at `instructions.ts:45` and `:51`.
- `resolveAgentsHome`: exported at `packages/util/home-paths/src/index.ts:151` and available, so finding 4 is a genuine case rather than a host gap.

Why it hurts a future change. Mirrors drift silently and a comment is not a gate. The two host-gap mirrors are worth escalating upstream, where a one-line re-export deletes both.

Smallest repair. File the re-export request for `findProjectRoot` plus the candidate and scope tables, keep each mirror in exactly one module meanwhile, and fix finding 4 now because nothing blocks it.

---

## What check:architecture cannot see, and why

The checker passes at 299 modules and 1123 dependencies. It enforces import direction between package folders, which is why finding 9 is a mechanism problem and not a violation. It cannot see:

- two registrations that collide at runtime because they share a name string (finding 1);
- an export with no caller (findings 2 and 7);
- one behaviour mirrored in two modules with different concurrency models (finding 3);
- a configuration default duplicated across the plugin and the host (finding 5);
- a class that has grown a second responsibility (finding 6).

Those five categories are worth a review checklist, because no gate fails on them.
