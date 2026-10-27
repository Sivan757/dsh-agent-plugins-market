# Simplification audit: dsh-agent-plugins-market

Read-only audit at dev head `3853273`. The working tree at audit time is not clean: another pass left an uncommitted security change in `packages/market-bundle/src/` (six route modules, `session-extension.ts`, one test, plus a new untracked `request-trust.ts` and its test, `git diff --stat` 25 insertions and 69 deletions). Nothing here was authored by this pass and none of it was touched. Where a line number comes from the modified tree, finding 2 says so, because that diff moves the exact lines it cites. Eight private packages behind one published artifact. Skill: `dsh-find-simplifications`. Method: read `git log --oneline -40` for where recent work landed, then grep every exported symbol for a caller outside its own file (script reproduced below), then read each candidate against `.agents/notes/` and `docs/scratch/audit/` so a deliberate decision is not re-proposed as residue. Findings are ranked by the cost of NOT fixing them.

The axis question is "what costs more to keep than to delete", so nothing below is proposed because it looks unfamiliar. Every entry names a caller search, a measurement, or drift that a gate cannot see.

**Note on the prescribed gate.** `docs/scratch/audit/README.md:19` tells the auditor to run `pnpm run duplication`. This repository has no such script (`package.json` scripts: `typecheck clean prebuild build build:client pretest test test:contract test:coverage lint format format:check check:architecture check:doc-links check:host-alignment fix:host-alignment check:quick check:reuse check:refactor prepack prepare`). `check:reuse` is the host reuse-ledger gate (`scripts/check-reuse.mjs:1-12`), not clone detection. So this repository has no duplication gate and no dead-export gate, and findings 2 and 11 below are the classes those gates would have caught. That is itself finding 11.

---

## 1. The guide page set is owned six times, and four copies are already wrong

**Severity: should-fix. Highest cost if left.**

**Responsibility: "which pages the guide contains, in reading order".**

| Owner | Location                                             | State at `3853273`                                              |
| ----- | ---------------------------------------------------- | --------------------------------------------------------------- |
| A     | `docs-site/.vitepress/guide.ts:21-44` (`GUIDES`)     | 11 pairs, complete                                              |
| B     | `docs-site/.vitepress/guide.ts:53-59` (`SECTIONS`)   | 11 pages, complete                                              |
| C     | `docs-site/.vitepress/config.mts:26-48` (`rewrites`) | complete, but gate-blind                                        |
| D     | `docs-site/.vitepress/config.mts:60-94` (`sidebar`)  | **9 of 11: `instructions` and `output-styles` absent**          |
| E     | `docs/AGENTS.md:9` (the `user/` table)               | **9 of 11: the same two absent**                                |
| F     | the `**Guide:**` line in 22 files under `docs/user/` | **`output-styles` named in 2 of 22, `instructions` in 4 of 22** |

Evidence, measured:

```text
grep -L "output-styles.md" docs/user/*.md   -> 20 files omit it
grep -L "instructions.md"   docs/user/*.md   -> 18 files omit it
grep -o "user/[a-z-]*\.md" docs/AGENTS.md    -> 9 names, not 11
config.mts sidebar items                      -> 9 links, not 11
```

C is the copy that already caused a defect. In PR #150 a new page 404'd because its `rewrites` entry was missing. `check:guide` passed and `check:links` only caught it because the README had started linking the page. A page nothing links yet fails silently.

D is a live user-visible defect today: the two newest guides cannot be reached from the site sidebar.

Why it costs more than it saves. Adding one guide page is currently five edits in four files plus 22 nav lines, and two of the six owners were missed on the last two features. `SECTIONS` already carries the section title in both languages, the display order, and the page list, which is exactly the sidebar's input. `GUIDES` already carries the page set, which is exactly the rewrite table's input.

Smallest repair, in two parts.

1. Derive both config.mts tables from the library it already ships beside it:

```ts
import { GUIDES, SECTIONS } from './guide'
const route = (page: string): string => (page.endsWith('.zh.md') ? 'docs/zh/' : 'docs/') + page.replace(/\.zh\.md$/, '.md')
const rewrites = Object.fromEntries(GUIDES.map(page => ['guide/' + page, route(page)]))
const sidebarItems = SECTIONS.map(section => ({ text: section.en, items: section.pages.map(page => ({ text: page, link: '/docs/' + page })) }))
```

2. Extend `docs-site/scripts/check-guide.mjs` so it reads the two Markdown copies too: every page's `**Guide:**` line must name every `GUIDES` base in `SECTIONS` order, and `docs/AGENTS.md:9` must list every base. That part is an addition, and it is what makes the deletions stay true.

**Lines removed / added.** `config.mts` loses 58 and gains 13, net **-45**. `check-guide.mjs` gains about 45 to close the class. The Markdown repairs are +2 lines in `docs/AGENTS.md` and 20 nav lines corrected.

**Risk.** Low for config.mts: `check:links` already proves every emitted route resolves, and it runs after the build. The nav-line repair touches 20 files but each edit inserts one link, and the new gate then holds them. The one real risk is the sidebar deriving its titles from `SECTIONS` (English only) where it currently hardcodes them, so the Chinese site keeps English sidebar labels, which is the current state anyway (the whole `sidebar` block is single-language).

---

## 2. Five byte-identical copies of the HTTP request plumbing

**Severity: should-fix.**

**Duplication a gate cannot see.** At HEAD, five route modules each declare the same four request helpers. `sameOrigin` appears five times, `readJsonBody` five, `sendJson` five, `MAX_BODY_BYTES` five, `queryOf` three. Hashes over the extracted `readJsonBody` and `sendJson` bodies are identical in all five files (`readJsonBody=aeb207f90b`, `sendJson=1dea0194d8`); `queryOf` is identical in the three files that have it (`bf405b2d16`).

Locations at HEAD (`git show HEAD:...`): `routes.ts:24,726,737,763,767`, `routes-resources.ts:37,121,132,157`, `routes-instructions.ts:39,119,130,135,160`, `routes-output-styles.ts:39,150,161,166,191`, `routes-tab-layout.ts:16,157,168,193`.

**The in-flight security change already removes one of the five families.** The uncommitted diff deletes `sameOrigin` from all five files and replaces it with the shared `isTrustedMutation` in the new `request-trust.ts`. That is the right direction and it halves this finding. The other four families are untouched by it, so what is left after that change lands is four copies of `readJsonBody`, four of `sendJson`, five of `MAX_BODY_BYTES` and three of `queryOf`. Line numbers after that diff: `routes.ts:25,728,754,758`, `routes-resources.ts:38,123,148`, `routes-instructions.ts:40,121,126,151`, `routes-output-styles.ts:40,152,157,182`, `routes-tab-layout.ts:17,159,184`.

The per-file JSDoc explains the copy as policy: `routes-tab-layout.ts:3-5` says "its own local request helpers for the same reason every other extra route module has them". Once `sameOrigin` is shared, that sentence has no support left: the fence is shared and the plumbing beside it is not.

Why it costs more than it saves. `readJsonBody` is the body-size fence and the parse-failure path for every mutating route. Five copies mean five places to fix when the cap, the destroy-on-oversize behavior, or the `Buffer.concat` handling changes, and four of them will be missed. `routes-extension-presets.ts` has already diverged: it has none of the three helpers and parses its body another way.

Smallest repair. One `packages/market-bundle/src/route-http.ts` exporting `MAX_BODY_BYTES`, `readJsonBody`, `queryOf`, `sendJson`, and delete the local declarations. Sequence it after the in-flight trust change so the two do not conflict in the same files.

**Lines removed / added.** Counted from the working tree, which already dropped `sameOrigin`: -167 and +60, net **-107**. Counted from HEAD, which still carries five `sameOrigin` bodies (about 12 lines each), the same repair removes roughly **-227** and adds the one module, net about **-167** and one fewer owner of the trust fence.

**Risk.** Low and mechanical. The bodies are identical, so behavior cannot change. Two things to sequence: the in-flight security diff touches every file in this list, so this change should follow it rather than race it, and `queryOf` should move in the same module even for the two files that never declared it, so there is one spelling rather than a third.

---

## 3. The `setMcpBackend` write path is a no-op that a test asserts as a no-op

**Severity: should-fix.**

**A mutating HTTP route with no effect and no caller.**

| Piece               | Location                                                                               |
| ------------------- | -------------------------------------------------------------------------------------- |
| Route constant      | `packages/market-contracts/src/contracts/market.ts:54`                                 |
| Route handler       | `packages/market-bundle/src/routes.ts:548-553`                                         |
| Service port method | `packages/market-contracts/src/ports/queries.ts:87`                                    |
| Catalog port method | `packages/market-contracts/src/ports/ports.ts:165`                                     |
| Fail-loud default   | `packages/market-contracts/src/ports/ports.ts:218-220`                                 |
| Implementation      | `packages/market-bundle/src/platform/settings-namespace.ts:126-128` (logs and returns) |
| Wiring              | `packages/market-bundle/src/index.ts:409`                                              |

Evidence that nothing consumes it:

- No client caller. `grep -rn setMcpBackend packages/market-ui/src` returns nothing. The UI reads `MARKET_ROUTES.mcpBackend` at `packages/market-ui/src/api.ts:420` and writes the backend through the host settings document instead.
- The implementation discards the value on purpose. `settings-namespace.ts:121-125` documents it as a "legacy write path" whose effect is a log line `(backend) ignored`.
- The test proves the discard. `packages/market-bundle/test/integration/routes.test.ts:235-237` posts `{backend:'host'}` and asserts `{ok:true, backend:'builtin'}`. The route accepts a change it does not make.
- Three other test doubles carry `setMcpBackend: async () => {}` purely to satisfy the port (`extension-project-details.test.ts:107`, `extension-hooks-detail.test.ts:115`, `routes.test.ts:60`).
- The read path is genuinely live, so the value still has a home. Only the write goes.

Why it costs more than it saves. A mutating route on a localhost HTTP surface is attack surface and a schema promise. It carries a 400 branch, a same-origin check, and a port method whose default implementation throws, all for a request that ends in a log line. A maintainer reading `ports.ts:165` believes an MCP backend switch is possible from the plugin.

Smallest repair. Delete the route constant, the handler, both port method declarations, the throwing default, the `settings-namespace` method, the `index.ts:409` wiring, the three test stubs, and the six-line test block. Keep `mcpBackend()`, `mcpBackendInfo()`, and `McpBackend`, which the read path uses.

**Lines removed / added.** -32 and +0, net **-32**. One route leaves the public HTTP surface and one method leaves two ports.

**Risk.** Low, but it is a wire removal. The only surviving prose that names it is a historical design doc, `docs/developer/design/compat-layouts-plan.md:111`, which describes the old effect chain and is not a user-facing contract. If any out-of-tree script drives the local API directly, that script breaks, so the change should say so in its commit message. Nothing in this repository does.

---

## 4. `groupStylesBySource` is an identity round trip, and the same grouping exists twice

**Severity: nice-to-have.**

**Needlessly indirect.** `packages/market-runtime/src/runtime/host/output-style-service.ts:197`:

```ts
return groupStylesBySource([...builtins, ...users, ...suites]).flatMap(group => group.rows)
```

`groupStylesBySource` (`packages/market-runtime/src/application/output-styles.ts:285-288`) buckets by source in the fixed order `['builtin','user','suite']` and drops empty groups. The input is already `[...builtins, ...users, ...suites]` in that exact order, so grouping then flattening returns the same array. The call is a no-op with a name that suggests order is being decided.

The same function also exists a second time, under a second name, in another package: `groupOutputStyles` at `packages/market-ui/src/features/output-styles/output-styles-view-model.ts:27-30` has the identical order array and the identical filter. Only the UI copy has a consumer that needs grouping.

Why it costs more than it saves. A reader of `output-style-service.ts:197` concludes the row order is computed there; it is computed by the spread. And the runtime copy is exported through `packages/market-runtime/src/index.ts:65`, so it is published surface a maintainer must keep.

Smallest repair. Return the concatenation directly, delete `groupStylesBySource` from the application module and from the barrel.

**Lines removed / added.** -8 and +1, net **-7**.

**Risk.** Very low. `packages/market-runtime/test/output-styles.test.ts` asserts the payload's row order, so a real reordering would still fail. The UI keeps its grouping, which renders headings.

---

## 5. `emptyTabLayout` is dead, and its JSDoc describes the caller it does not have

**Severity: nice-to-have.**

`packages/market-contracts/src/contracts/tab-layout.ts:44` exports `emptyTabLayout`. Its only two occurrences in the repository are its own definition and the `{@link emptyTabLayout}` inside the JSDoc of its neighbour `defaultTabLayout` at line 63.

Its JSDoc (lines 35-43) says it is "the all-visible layout an explicit empty choice writes". No choice writes it. "Show every tab again" is `TabLayoutService.showAll` (`packages/market-runtime/src/runtime/host/tab-layout-service.ts`), which calls `saveTabLayout(dataRoot, workspace, [])` and lets `resolveHiddenTabs` rebuild the record. So the function is dead and the sentence explaining it is false, which is the pair that costs a reader most: they believe a writer exists and look for it.

Also in the same file, `isTabStowed` (line 147) has exactly one caller, `visibleTabs` at line 164, in the same module. The `export` is unnecessary surface but the function is live.

Why it costs more than it saves. Two exported names promise a public representation of "nothing stowed" that the product reaches through an empty array instead. Deleting one and un-exporting the other removes the choice between two ways to say the same thing.

Smallest repair. Delete `emptyTabLayout` and the `{@link}` reference to it. Drop `export` from `isTabStowed`.

**Lines removed / added.** -11 and +2, net **-9**.

**Risk.** None. Both symbols are re-exported by no barrel and imported by no test; `grep -rnw emptyTabLayout packages` returns only the definition and the doc link.

---

## 6. The tab-layout contract documents a second display-order list and a drift assertion that no longer exist

**Severity: nice-to-have.**

`packages/market-contracts/src/contracts/tab-layout.ts:6-11`:

> The client renders the row from its own display-order list and treats this list as the stowable set, so the two must name the same tabs. The drift assertion in `packages/market-ui/test/client-workspace-tab-stow.test.ts` fails when a tab is added to one and not the other, which is the moment to extend this list.

There is no second list. Commit `0f6d447` (`refactor(workspace): derive the tab row from the contract key list`) removed it. The client now re-exports the contract array by reference: `packages/market-ui/src/workspace/PluginWorkspace.tsx:58` is `export const TAB_ORDER: ReadonlyArray<WorkspaceTab> = WORKSPACE_TAB_KEYS`, and the test at `client-workspace-tab-stow.test.ts:157` asserts `expect(TAB_ORDER).toBe(WORKSPACE_TAB_KEYS)`, an identity check, not a drift check between two lists.

Why it costs more than it saves. This comment is the documentation of the single-owner property that commit `0f6d447` established, and it now describes the opposite. A maintainer adding a tab reads it, looks for the client list, does not find one, and cannot tell whether the file is stale or they are missing something.

Smallest repair. Replace with what is true: the client renders the row from this array by reference and the compiler plus the identity test keep it single.

**Lines removed / added.** -6 and +3, net **-3**.

**Risk.** None. Comment only.

---

## 7. An unreachable fallback keeps `TAB_ORDER` alive for tests alone

**Severity: nice-to-have.**

`packages/market-ui/src/workspace/PluginWorkspace.tsx:71-73`:

```ts
function rowTabs(layout: TabLayoutWire, active: WorkspaceTab): WorkspaceTab[] {
  return visibleTabs(layout.order.length > 0 ? layout.order : TAB_ORDER, layout, active)
}
```

`layout.order` cannot be empty for any value the code accepts. Every producer passes through `resolveTabOrder` (`packages/market-contracts/src/contracts/tab-layout.ts:100-110`), which appends every missing key, so its result is always a complete permutation of a nine-key list. The two starting values, `defaultTabLayout` and `readTabLayout`, are built from it. The wire type requires `order` and the service republishes through `resolveTabOrder` after every write.

So the `TAB_ORDER` branch is dead, and after removing it `TAB_ORDER` has no production consumer: its only other references are the stow test's imports.

Why it costs more than it saves. A defensive fallback on an impossible state reads as evidence the state is possible, so the next reader keeps the invariant in mind forever. It also hides that the row order and `TAB_ORDER` are the same array.

Smallest repair. `return visibleTabs(layout.order, layout, active)`. Then either keep `TAB_ORDER` as the test's handle on the display order with a comment saying so, or drop it and have the test import `WORKSPACE_TAB_KEYS` directly, which it already does at line 30.

**Lines removed / added.** -3 and +1, net **-2**.

**Risk.** Very low. If a future path ever produced an empty `order`, the row would render no tabs; today no such path exists, and `resolveTabOrder` is the single clamp that prevents it.

---

## 8. Four comments state a tab count that is three features out of date

**Severity: nice-to-have.**

| Location | Text | Actual |
| --- | --- | --- |
| `packages/market-ui/src/workspace/PluginWorkspace.tsx:2` | "one page, seven top tabs" | nine |
| `packages/market-ui/src/workspace/PluginWorkspace.tsx:84` | "One page with six top tabs" | nine |
| `packages/market-ui/src/index.ts:305` | "One section, six top tabs (market / skills / commands / personas / MCP / LSP)" | nine |
| `packages/market-ui/src/ui/panel.tsx:5` | "the six panels repeat" | the panels share one header; the count names no fact |

The count is derivable and now stated four times, so it drifts on every tab addition. `WORKSPACE_TAB_KEYS` (`packages/market-contracts/src/contracts/tab-layout.ts:12`) is the owner and the compiler enforces the label map, so the numbers add nothing.

Why it costs more than it saves. A reader who trusts "six top tabs" and counts nine looks for the discrepancy in the wrong place. The parenthesised list in `index.ts:305` is worse than the number: it names a tab set that has been wrong since `instructions` landed.

Smallest repair. In all four, name the owner instead of the count, or drop the clause.

**Lines removed / added.** -4 and +4, net **0**. This is a correctness fix, not a size one.

**Risk.** None. Comments only.

---

## 9. `formatBytes` is a rename of `String`

**Severity: nice-to-have.**

`packages/market-ui/src/features/instructions/instructions-view-model.ts:105-107`:

```ts
export function formatBytes(bytes: number): string {
  return String(bytes)
}
```

Seven call sites in `InstructionsPanel.tsx` (`:154,` `:238`, `:255`, `:292`, `:294`) pass its result straight into `t()` parameters. A wrapper that only forwards makes a reader check the body to learn there is no formatting, then keep the name in mind as if there were.

Why it costs more than it saves. It is exported from a view-model module whose other exports decide real things (`budgetPercent`, `isOverBudget`, `statusTone`), so the one no-op is indistinguishable from them at the import site.

Smallest repair. Delete it and pass the number to `t()`.

**Lines removed / added.** -4 and +0, net **-4**.

**Risk.** None, verified. All seven call sites (five lines: `154`, `238`, `255`, `292`, `294`) are inside a `t()` params object, and no call site uses the result any other way (`grep formatBytes( | grep -v "t("` returns 0). `Translate` takes `Record<string, unknown>` (`packages/market-ui/src/i18n.ts:14`), so a number is accepted and the template substitutes it exactly as the wrapper did. If a thousands separator is ever wanted, that belongs in the locale dictionary, not in a named function that currently adds none.

---

## 10. No gate watches exports with no consumer, and the class is 64 wide

**Severity: nice-to-have.** Reported as a gate, not a bulk edit.

Measured over `git ls-files 'packages/*/src/*.ts(x)'`, counting references outside the defining file:

- 64 exported symbols have no reference anywhere outside their defining module.
- 3 of those are wholly unreferenced, tests included: `mergeTranslationFields` (`packages/market-contracts/src/contracts/translation.ts:84`), `mountProjectHooks` (`packages/market-runtime/src/runtime/surfaces/project-runtime.ts:59`), `isWritable` (`packages/market-ui/src/features/instructions/instructions-view-model.ts:81`). **Already reported** as `docs/scratch/audit/architecture.md` finding 7, so this audit does not re-propose them.
- The remaining 61 are used inside their own module. Examples: `DYNAMIC_CONTEXT_TIMEOUT_MS` (`runtime/surfaces/dynamic-context.ts:22`), `MAX_EN_BATCH_CHARS` (`market-translation/src/application/translation/localizer.ts:124`), `RECONNECT_DEFAULTS` (`market-mcp/src/runtime/mcp/bridge/connection.ts:42`), `SERVER_NAME_PATTERN` (`market-mcp/src/application/mcp/mcp-bridge-config.ts:38`), `MUTATION_TIMEOUT_MS` (`market-ui/src/api.ts:78`).

Why it costs more than it saves. Each is a published-looking promise that a consumer may exist, so deleting or renaming it is a compatibility question nobody can answer from the code. The repository already runs a reuse gate (`check:reuse`) but nothing looks for absent consumers, so the class grows with every feature.

Smallest repair. Extend `scripts/check-reuse.mjs` (or `check:quick`) with a dead-export rule: an exported value with zero references outside its file, and no `export {` from a barrel, fails unless listed in a small allow-list with a reason. Do the 61 un-exports opportunistically, never as one sweeping diff, because each removal is safe but the diff is unreviewable.

**Lines removed / added.** 0 for the gate (about 40 added to the script). The bulk un-export is roughly -61 and +61.

**Risk.** The rule must key on values, not types, and must recognize barrel re-exports, or it will fire on every public entry point. `packages/market-ui/src/index.ts` and each package `index.ts` exist to be re-exported and have no in-tree consumer by design.

---

## 11. The audit process names a gate this repository does not have

**Severity: nice-to-have.**

`docs/scratch/audit/README.md:19` instructs the auditor to run `duplication` among the pre-audit gates. `package.json` has no `duplication` script, and `scripts/` contains no clone detector. The instruction was carried over from the harness repository, where that script exists.

Why it costs more than it saves. The audit pass believes the duplication axis is guarded, so findings 2 and 10 arrive as surprises each pass, and a reviewer who runs the named gate sees a `Missing script` error and moves on.

Smallest repair. Either name the gates this repository has, or add the gate. The README already tells the auditor the point: "A red gate is worth more than any report."

**Lines removed / added.** -1 and +1 for the prose, or about +40 for the gate.

**Risk.** None for the prose. Adding a clone detector is a dependency decision for the maintainer, so the prose fix is the safe default.

---

## Checked and NOT redundant

These were examined, are correct, and should not be re-proposed without new evidence.

- **The `**Guide:**` sibling line in the 22 `docs/user/` pages.** It reads like a copy of `GUIDES` (finding 1), and it is. `docs/AGENTS.md:25` mandates it because GitHub renders the guides without the site sidebar, so it is deliberate. Keep the line and gate it. Do not delete it as duplication.
- **`GUIDES` and `SECTIONS` both existing in `guide.ts`.** They are not duplicates: `GUIDES` is the flat file list the copy and gate scripts read, `SECTIONS` is the display grouping `GuideIndex.vue` renders. `check-guide.mjs` already enforces that they agree, which is the correct relationship for two views of one set.
- **`docs-site/guide/` as a generated copy.** `copy-guide.mjs` produces it, it is gitignored, and `check-guide.mjs` recomputes the link rewrite against it. Generated, not maintained.
- **The three wholly-unreferenced exports** (`mergeTranslationFields`, `mountProjectHooks`, `isWritable`). Already reported in `docs/scratch/audit/architecture.md` finding 7. Also in that report: `project-runtime.ts`'s four production-less mounts (finding 2) and `SEAM_ADAPTERS` (finding 8). Not repeated here.
- **`isTrustedMutation` as the single trust fence.** The five route modules share it rather than each defining `sameOrigin`. The duplication in finding 2 is the plumbing around it, not the fence, and the fence must not be inlined back into the route files.
- **One state document per responsibility.** `application/state/tab-layout.ts`, `output-style.ts`, `workspace-policy.ts` and `extension-presets.ts` each repeat the `mkdir` + `withFileLock` + `writeJsonDocument` scaffold, which looks extractable. It is not worth extracting: each document's tolerant-read policy genuinely differs (tab-layout falls back to a three-tab default, output-style falls back to the default selection, extension-presets migrates a legacy key), and the stated reason for the split is that one writer per file prevents two surfaces clobbering each other. The workspace-hash path expression alone is three identical lines (`tab-layout.ts:35-37`, `workspace-policy.ts:26-28`, `output-style.ts:50-52`) and would cost about -9/+14 to share, so it is not worth its own change either.
- **`resolveHiddenTabs`'s pinned-tab clamp.** It looks like over-validation for a value the client also checks, but it is the second line of a two-line fence: the route refuses a body naming the pinned tab and the store clamps a hand-edited file. Removing either line leaves a state where the row can render nothing.
- **`defaultCatalogPorts.setMcpBackend` throwing.** It is the fail-loud default the AGENTS.md rule asks for, so it is not accidental residue. It disappears with finding 3 because the whole operation does, not because fail-loud was wrong.
- **`attribute()` and `escapeFrameBody` staying separate in `prompt-frame.ts`.** Coming out of PR #148: `attribute()` renders one `###` per contributor for rule R5, `escapeFrameBody` owns the escape. The output-style section calls the escaper and not `attribute()`, and the Agent Note records why, so the asymmetry is decided rather than missed.
- **`MAX_BODY_BYTES = 64 * 1024` as a literal rather than a config field.** The AGENTS.md no-hardcoded-tunables rule exempts fixed protocol and security invariants, and a request-body cap alongside the same-origin fence is one.
- **`fetchUserPanel` (`market-ui/src/api.ts:433`)**, test-only, and `ComposerResourceEntry`. Already in `docs/scratch/audit/architecture.md` finding 7.

---

## Totals

| #   | Finding                                                         | Severity     | Net lines                                                 |
| --- | --------------------------------------------------------------- | ------------ | --------------------------------------------------------- |
| 1   | Guide page set owned six times, four copies wrong               | should-fix   | -45 (plus ~+45 to gate it)                                |
| 2   | Five copies of the HTTP request plumbing                        | should-fix   | -107 after the in-flight trust diff, about -167 from HEAD |
| 3   | `setMcpBackend` no-op write path                                | should-fix   | -32                                                       |
| 4   | `groupStylesBySource` identity round trip, duplicated in the UI | nice-to-have | -7                                                        |
| 5   | `emptyTabLayout` dead, JSDoc false                              | nice-to-have | -9                                                        |
| 6   | Tab-layout comment describes a deleted second list              | nice-to-have | -3                                                        |
| 7   | Unreachable fallback in `rowTabs`                               | nice-to-have | -2                                                        |
| 8   | Four stale tab-count comments                                   | nice-to-have | 0                                                         |
| 9   | `formatBytes` forwards to `String`                              | nice-to-have | -4                                                        |
| 10  | No dead-export gate, 64-symbol class                            | nice-to-have | 0 (gate ~+40)                                             |
| 11  | Audit README names a gate that does not exist                   | nice-to-have | -1                                                        |

Findings 2, 3, 4, 5, 6 and 9 are pure deletions or comment corrections with no behavior change: **about -162 lines**, or about -222 if finding 2 is taken from HEAD. Findings 1, 8 and 11 fix drift that a gate cannot see. Findings 7 and 10 remove a dead branch and close a class.

Nothing in this report was applied. The only file this pass wrote is this one.

## Verification limits

Every claim above is from static reads and the greps shown, at `3853273`. The exception is finding 2's after-diff line numbers, which come from the uncommitted tree described in the header. I did not execute the gates in this pass, so the line counts are estimates from the current file contents, not measurements of an applied patch. Finding 3 is the only one that removes wire surface, and it would need `pnpm run test` plus `pnpm run build` before landing. Finding 1's config.mts derivation needs a `docs-site` build, because `rewrites` is consumed by VitePress at build time and unit tests do not exercise it.
