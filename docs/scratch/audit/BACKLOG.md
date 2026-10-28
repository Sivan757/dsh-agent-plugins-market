# Audit backlog

One ranked list, built from the five audit reports in this directory plus the open prompt-conformance work. Each entry names its evidence, so an entry can be checked rather than trusted.

Ranked by the cost of NOT fixing. The pass that produces this list is described in `README.md`.

## Wave 1 - security (the only blockers)

| # | Fix | Evidence | State |
| --- | --- | --- | --- |
| 1 | One request-trust fence for all six mutating route groups: a loopback `Host` check and a `sec-fetch-site` refusal, replacing six copies of `Origin === Host` which a rebinding page satisfies | `security.md` S1 | **done** |
| 2 | A hook dry run must not execute a disabled project suite's command: read `enabledSuites`, as every other surface does | `security.md` S2 | **done** |

S1 and S2 compose: rebinding plus a checked-in but disabled suite was unauthenticated command execution. Fixing either alone leaves a reachable path, which is why they share a wave.

## Wave 2 - correctness and duplication

| #   | Fix                                                                                                                                         | Evidence               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 3   | Five byte-identical `readJsonBody`/`sendJson`/`MAX_BODY_BYTES` copies, plus `queryOf` three times, across `routes*.ts`                      | `simplification.md` 2  |
| 4   | Delete the `setMcpBackend` write path: a mutating HTTP route whose implementation only logs                                                 | `simplification.md` 3  |
| 5   | Delete `mountSuiteInstructions` and the three other dead exports of `project-runtime.ts`; move `suiteInstructions` to a module named for it | `architecture.md` 1, 2 |
| 6   | One owner for the project-root climb, and `resolveAgentsRoot` should return the host's `resolveAgentsHome`                                  | `architecture.md` 3, 4 |
| 7   | The instruction budget is declared twice; drop the plugin fields or make them display-only                                                  | `architecture.md` 5    |

## Wave 3 - performance, measured

| # | Fix | Evidence | Measured? |
| --- | --- | --- | --- |
| 8 | The client ships 960 KB of CodeMirror and lezer, 52.6% of the bundle, for an editor three dialogs render | `performance.md` 1 | yes |
| 9 | An idle session polls `/extension-presets/window` every 2500 ms with no visibility pause, rebuilding the inventory each time | `performance.md` 2 | constants yes, aggregate estimated |
| 10 | `ROW_CACHE_MAX_AGE_MS` (2000) is shorter than the poll (2500), so the cache never absorbs it; derive one from the other | `performance.md` 3 | yes |
| 11 | Project panels are keyed by `Agent` while `cwd` is the only variable, so N sessions in one workspace scan N times | `performance.md` 4 | per-doc yes |
| 12 | Every Market tab mount issues two `/overview` GETs and discards the render-time one | `performance.md` 6 | yes |
| 13 | Skills are YAML-parsed twice per row, 28% of scan cost | `performance.md` 5 | yes |

## Wave 4 - documentation that lies

The prose audit found claims a reader would act on and be wrong. Each is cheap and each is a trap.

| #   | Fix                                                                                    | Evidence              |
| --- | -------------------------------------------------------------------------------------- | --------------------- |
| 14  | The hooks guide says seven events on a retired bridge; ten run on the hook protocol    | `prose.md` D2         |
| 15  | The README tab table names five tabs the UI never shows                                | `prose.md` D2         |
| 16  | The install guide quotes a caret range no longer declared                              | `prose.md` D2         |
| 17  | 27 Agent Notes cite `src/` paths that moved to `packages/<group>/<pkg>/src`            | `prose.md` D3         |
| 18  | The docs site sidebar omits two of eleven guide pages, and `docs/AGENTS.md` lists nine | `simplification.md` 1 |
| 19  | Three Agent Note bilingual pairs dropped a fact on the zh side, not formatting         | `prose.md`            |

## Wave 5 - structure and cleanup

| #   | Fix                                                                                                       | Evidence                                    |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 20  | `extension-hooks.ts` is 964 lines carrying six responsibilities; extract the pure mappers                 | `architecture.md` 6                         |
| 21  | Fourteen test-only or orphan exports, and no gate that would notice the next one                          | `architecture.md` 7, `simplification.md` 11 |
| 22  | Delete `SEAM_ADAPTERS`: production calls the four functions directly                                      | `architecture.md` 8                         |
| 23  | `emptyTabLayout`, `groupStylesBySource`, `formatBytes`, the `TAB_ORDER` fallback, and four stale comments | `simplification.md` 4-9                     |
| 24  | 94 deep relative imports bypass the `exports` maps                                                        | `architecture.md` 9                         |

## Not in this backlog

Findings the audits checked and found correct. Proposing them again wastes a pass.

- Archive extraction, path containment, and instruction write/delete: all defended, with the defence cited in `security.md`.
- `resolveHiddenTabs`'s pinned-tab clamp, the per-responsibility state documents, the per-page Guide navigation line, and the generated `docs-site/guide/` copy: each is deliberate.
- The prompt-side shapes recorded in `docs/scratch/prompt-research/corrections.md`.

## A finding that needs a host change before it can be fixed

Row 8 (CodeMirror at 52.6% of the client bundle) cannot be fixed inside this plugin. Measured from the build path:

- `tsdown.config.ts` builds one CJS entry, `packages/market-ui/src/index.ts`, into one `client/client.js`. A dynamic `import()` inside a CJS bundle resolves at runtime through `require`, not through a chunk loader, so the editor cannot become a lazy chunk here.
- The host can load more than one file: `packages/client/modules/src/index.ts:563` exposes `__ModuleLoader__`, and `packages/client/web/src/boot.ts:59-79` accepts a `loadBundle` seam plus a plugin manifest with a per-plugin entry list.
- Using it means the plugin advertises several entries and serves each one over its own route, and every consumer that reads `client/client.js` directly has to learn the extra files. That is a host-contract change with a plugin-version requirement, not a cleanup.

The cheaper option, which needs no host change, is to stop shipping a 960 KB editor for three dialogs and use a plain textarea for the two Markdown bodies, keeping the editor only where JSON structure matters. That is a product decision about editing comfort, so it is recorded here rather than made in a cleanup pass.

Recommendation: take the textarea option for the Markdown editors now, and revisit the multi-entry split only if the host exposes a documented plugin-chunk contract.

## Where this pass landed

All five waves are on `dev`, one PR each, in this order: #157 conformance, #158 test hardening, #159 Wave 5 cleanup, #160 Wave 2 dedup, #162 Wave 4 docs, #161 Wave 3 performance.

| Wave          | Items                  | Landed as |
| ------------- | ---------------------- | --------- |
| 1 security    | 1, 2                   | #156      |
| 2 dedup       | 3, 4, 6, 7             | #160      |
| 3 performance | 9, 10, 11, 12, 13      | #161      |
| 4 docs        | 14, 15, 16, 17, 18, 19 | #162      |
| 5 cleanup     | 22, 23                 | #159      |
| tests         | F1 to F8               | #158      |
| conformance   | the eight prompt fixes | #157      |

Still open, in the order worth doing them:

| Item | Why it is still open |
| --- | --- |
| 8 bundle weight | Needs a host contract for plugin chunks, or a product decision to drop the Markdown editors to a textarea. See the section above. |
| 20 split `extension-hooks.ts` | Deferred because two branches were rewriting it at once. It is 964 lines and nothing else is queued against it now. |
| 21 dead-export gate | The deletions it would police have landed, so it is buildable now. It is the one addition that would have caught items 22 and 23 mechanically. |
| 24 deep relative imports | 94 files, mechanical, wants its own pass. |
| finding 8 | `extension-runtime.ts:421` still rebuilds the inventory on every visible poll: 24 rebuilds a minute, measured at a median 45 ms each on 60 documents. The skip is a 98% cut and was declined because the poll is the only path by which a hand-edited frontmatter change reaches the manager. The recorded repair is a fingerprint guard over the `stat` stamps `stamp` already collects. |

## Two merges that were only green on their own branch

Item 5 and the conformance fix 14 disagreed with a test added in the same wave: fix 14 emptied three bookkeeping messages, and the test still asserted two of their sentences reached the host as `text:` literals. Each PR passed against a base without the other. Resolved in `1a11cf1` by pinning the contract the producer actually has.

The host-alignment gate had the same shape of gap in a different place: it demanded exclusions only for packages the manifest names, while pnpm's release-age policy covers the whole resolved graph. That shipped a tree whose `pnpm install` failed for 26 transitive entries while the gate reported green. Fixed in `ac6a0b3` and `cfbf74b`, with the gate now reading the lockfile.

Both are the same lesson: a gate that checks one of two owners of a fact is a gate that will let the pair drift. The next pass should look for that pattern before adding assertions.

## Second pass

| Item | Outcome |
| --- | --- |
| 21 dead-export gate | **done** as `4c2f9ef`. `scripts/check-dead-exports.mjs` plus `docs/reference/public-exports.md`, wired into `check:refactor`. It found fifteen entry exports with no consumer outside their package, all stale rather than hidden contracts, so all fifteen were removed instead of recorded. Proved in both directions. |
| 20 split `extension-hooks.ts` | **declined, with the reason.** The file is 964 lines but nothing measured says its size costs anything: no compile, load or review wait traces to it, and the hook protocol is the one surface every other feature touches. A split would add module indirection and a merge point for no measured gain. The condition that would change this is a second feature needing the same internals, which is when the shared part should be extracted on its own evidence. |
| 24 deep relative imports | **deferred on cost, not value.** Ninety-four files for a mechanical import rewrite. It touches every package at once, so it blocks any branch in flight and cannot be reviewed by reading. Worth doing as the first commit of a quiet week rather than inside an audit pass. |

## The gap this pass exposed in CI

The quality workflow ran on `main` pushes and pull requests, not on `dev` pushes. Every direct commit to `dev` in this pass therefore ran no CI at all, and the local gate was the only evidence. That is now fixed by adding `dev` to the push triggers, because `dev` takes direct commits and is what the next release is cut from.

### finding 8, closed

The visible poll no longer rebuilds the panel inventory from a scan when nothing moved. `PanelResources` recorded only the detail-row age, so every poll past it rescanned every document; it now also records each document's `mtime` and `size` at scan time, and a sweep compares those numbers instead of reading the files.

|                    | per poll, 60 documents |
| ------------------ | ---------------------- |
| full scan (before) | 1.62 ms median         |
| stat sweep (after) | 0.32 ms median         |

About 80% off the per-poll cost, and the scan itself is what the audit measured at 45 ms on a real suite panel set, so the saving there is larger. `scans total=5` over one initial read plus four forced scans in the benchmark confirms the four polls in between did no scan at all.

The previous attempt at this was declined because skipping the read would also skip a hand edit. That is still true of a `stale` flag, which only an in-process catalog change sets. It is not true of a stat sweep: an edit moves `mtime` and usually `size`, so the next poll rescans and the new value appears within one interval. What a sweep cannot see is a document added, removed, or renamed, so the sweep only extends the reuse up to `ROW_SWEEP_MAX_AGE_MS`, two window polls, which is how long a hand-dropped file can stay unlisted. Both properties are pinned by tests in `panel-row-sweep.test.ts`, and an empty signature set answers unsafe rather than safe so an unreadable panel still rescans.

## item 24 is rejected, not deferred

Converting the deep relative imports to `@dsh-market/*` package specifiers looked like a mechanical modernization. It is not safe, and the reason is the published artifact:

- The root package ships `files: ["lib", ...]`, and `lib/packages/**` holds the emitted tree. A shipped module reads `from '../../../market-catalog/src/index.js'` (`lib/packages/market-runtime/src/application/panel-resources.js:5`), so the relative path survives compilation and is what makes the artifact self-contained.
- The sibling packages are `private: true` and their `exports` point at `./src/*.ts`. They are never published, so a `@dsh-market/contracts` specifier in shipped code would resolve at build time and fail at run time for a user who installed the plugin from npm.

`tsdown` bundles the client entry, so the browser side would survive the change. The server side does not. The imports are the price of shipping one package, and the correct fix for their brittleness is a review habit, not a rewrite.

## item 8 now has a number to argue with

`pnpm run check:bundle` (`scripts/check-bundle-budget.mjs`) fails the build when `client/client.js` grows past 1,900,000 bytes; the tree measures 1,831,600 today, so the budget sits at 96.4% of the ceiling. It runs in the quality job after `pnpm run build`, because it prices the artifact rather than the source.

That leaves one open decision and nothing else. The CodeMirror and lezer graph is about half the bundle and every one of its six packages is imported, so there is no unused weight to drop. Removing it means giving up syntax highlighting in the Markdown editors, or the host growing a documented plugin-chunk contract; the first is a product call and the second is not this repository's to make. Until one happens the budget holds the line.

## item 8, measured three ways

The row used to say the editor graph is 52.6% of the client bundle. That figure was a static estimate; this is the built artifact, three times, in a throwaway worktree off `dev`:

| Variant                                         | `client/client.js` | Change              | What the user loses                                                              |
| ----------------------------------------------- | ------------------ | ------------------- | -------------------------------------------------------------------------------- |
| shipped                                         | 1,831,600 B        | -                   | nothing                                                                          |
| Markdown grammar dropped, JSON keeps the editor | 1,550,862 B        | -280,738 B (-15.3%) | Markdown highlighting only                                                       |
| Every editor replaced by a textarea             | 869,357 B          | -962,243 B (-52.5%) | all highlighting, line numbers, bracket matching, the undo keymap and tab indent |

So the 52.6% estimate was accurate, and it is not one decision but two. Dropping only the Markdown grammar keeps JSON structure readable and still returns 15%; dropping the editor entirely returns half the bundle and gives up every editing affordance in three dialogs, which is a product regression rather than a cleanup.

Nothing is applied. The budget gate holds the line at 1,900,000 B until someone chooses, and the choice is a product call about editing comfort, not a defect.

One correction to the earlier note: the JSON editors are the ones that need the editor most (they validate and pretty-print structure), while the Markdown bodies are prose. If a partial change is ever wanted, it goes in that direction.

## The gap this pass found by hand

Moving both rows onto a new component left the old one imported by nothing: `ResourceTabs.tsx` and its stylesheet, 156 lines that compiled, linted and tested exactly like live code. Neither existing gate could see it. `check:exports` compares package-entry exports, and this module was never an entry export; `check:duplication` looks for bodies in two places, and this was one body in zero.

The check that found it was asking, after a component swap, what still imports the old one. That is a third gate worth building: every source module under `packages/*/src` must be reachable from a package entry, by import or by dynamic import, or be named in a ledger with the reason it exists (a test-only helper, a script entry the host loads by path). It is the same shape as the dead-export gate one level down, and it would have caught this the moment the swap landed.

Not built here: the honest order is to land the rail first, then build the gate against a tree where its finding is already fixed, which is how the export and duplication gates each started from zero.

## The third gate exists now, and it found a feature nobody mounts

`pnpm run check:modules` walks every import from the eight package entries and fails when a module is never reached. It found five, so the count in the previous section was short.

Four of them are one unwired feature surface: `ResourceWindow.tsx`, `ComposerResourceEntry.tsx` and the client they share under `packages/market-ui/src/features/resource-window/`, plus the locale strings for it in `locales-resources.ts`. The client entry registers composer and settings slots without importing any of them, so nothing mounts that window, while `client-resource-window.test.ts` still passes over it and its copy still ships in the bundle.

The fifth pair are persistence helpers read only by their own tests: `server-config.ts` in the bundle and `surface-toggles.ts` in the runtime. The route groups keep the wired behaviour, so the modules are the older half of a superseded path.

All five are recorded in `docs/reference/module-reachability.md` with the test that reads each one, and left in place. Deleting them retires a feature surface, which is a product decision rather than an audit cleanup; what the ledger buys is a gate that stays strict about everything else while that decision waits.

**Open item:** retire or re-wire the resource-window surface. It is the last known code in this repository that ships, tests and renders nothing.

## The unwired surface is cheap in bytes and expensive in attention

Built in a throwaway worktree with the resource-window surface deleted: typecheck passes with nothing else touched, so the four modules and their copy are self-contained. The bundle moved from 1,843,056 to 1,839,328 bytes, which is 3,728 bytes, or 0.2%.

That is smaller than expected, and the reason is worth writing down: the bundler already tree-shakes an unreachable module, so the compiled JavaScript of that surface was never in the shipped file. What a deletion actually recovers is the locale strings and a few exports, not the 660 lines.

So the earlier framing was wrong. This is not a bundle item; it is a maintenance item. What the surface costs today is a 528-line component, two supporting modules and 74 locale lines that no screen reaches, one integration test that passes over them, and a reader who cannot tell from the file tree which market features are live. The byte saving is a rounding error by comparison.

The decision is therefore about whether the surface should come back, not about its weight. If it should return, the fix is one import and a slot registration. If it should not, deleting it costs one diff and removes a test that currently proves nothing about the product.

**Gate fix that came out of the same probe:** a ledger row naming a module that no longer exists used to report `ledger-stale`, the same code as a module that became reachable again. Those are two mistakes with two different repairs, so a missing file now reports `ledger-missing`.

## The 404 was ours, and the first fix was half wrong

The browser walkthrough found one session spending 336 reads and 336 console errors on `/api/agent-plugins/extension-presets`, every one a 404, with no sign of stopping. The first fix read that as a route the host does not serve and stopped the poll for good.

The response body says otherwise. Our own route answered, with `{"ok":false,"code":"extension-session-not-found"}`, which the handler maps to 404. The route was mounted the whole time; the _service_ was reporting that a session opened from history has no live agent in this process. Opening a session does not create one, so that answer is stable until the session is used.

That makes both extremes wrong. Polling every 2.5s wastes a request per interval on an answer that cannot change. Stopping forever leaves a manager that never notices the session going live. The poll now backs off while the answer is `extension-session-not-found`, doubling the wait to a 30s cap, and keeps asking.

Measured live in the same profile, 45 seconds of wall clock: reads at 0.2s and 30.3s, so two instead of eighteen, and the second one proves the loop is still alive.

**Lesson worth keeping:** the walkthrough caught a real defect, and then reading only the status code nearly turned it into a different one. The body had the answer.

The distinction is now explicit in `readWindow`: our `extension-session-not-found` envelope means not-ready, a 404 without it means no route, and the two get different treatment.

## Cold-path walkthrough: panels render, and one control reads wrong

Every tab was driven in the built app, in an independent profile: 市场, 输出风格, 技能, 快捷指令, 专家, 连接器, plus the three stowed ones after revealing them (规则, 语言引擎, 钩子). Each rendered content and fired no failing request: 输出风格 369 characters, 连接器 457, 语言引擎 108, 钩子 45 with its empty state, the three list panels in the thousands.

The tab-layout endpoints are sound. `GET /api/agent-plugins/tab-layout` returns the document, and `POST /api/agent-plugins/tab-layout/set` with `{hidden:['lsp','hooks']}` answers `{ok:true, hidden:['lsp','hooks']}` and writes the file. A first probe posted to the read path, which is registered for GET only and answers 200 with the unchanged document, so the write looked lost when it had never been attempted.

**One control reads wrong.** The row's menu lists the stowed tabs, and clicking one selects it. Because the selected tab is always rendered even when stowed, the tab appears: the click looks like "show this tab". Switch to another tab and it disappears again, because the stow list never changed. Observed directly: 语言引擎 appeared after its menu item, and was gone after selecting 钩子.

That is the interaction working as designed and communicating something else. Three ways out, in order of preference: rename the menu group so it reads as a jump ("跳转到已收纳"), have the click un-stow and persist (which is what the words imply), or drop the group and leave the manager as the only path. Not changed here, because it is a product call about what the row should promise.

## The tarball is whole, and now something checks it

The published artifact was never verified as an installed package; every check here runs against the repository. It is whole: `pnpm pack` plus `npm install` in an empty project ships 189 built modules, all 531 relative specifiers resolve inside them, and both `lib/index.js` and the client bundle parse.

That also settles the deepest worry in this file, the relative cross-package imports recorded as item 24. They are what makes the tarball work: the sibling packages are private with `exports` pointing at `./src/*.ts`, so a package specifier would have resolved here and failed for an installed user.

The gap was that nothing noticed if that stopped being true. `pnpm run check:package` now walks the built graph, resolves every relative specifier against the paths `files` actually ships, and reports `unresolved-import`, `outside-package` or `missing-entry`.

Its first version was wrong in a way only the negative control found. It read `from '...'` and `import('...')` and not a side-effect `import './x.js'`, so a probe importing an unshipped path passed. Side-effect imports have their own patterns now, and the control fails as it should.

## The composer entry has never rendered, and the host seat is why

The preset manager's door is a seat in `conversation.input.left`. Our registration reads `props.sessionId`, and the host never supplies one:

- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:469` renders `renderSlot('conversation.input.left', {})`;
- the installed 0.2.1-rc.3 bundle does the same, `input === void 0 || sessionId === void 0 ? null : renderSlot("conversation.input.left", {})` — the call is guarded by a session check and passes nothing;
- every other composer seat is the same: `.right`, `.overlay`, `.dock` and `conversation.composer.dock` all receive `{}`, and only the three sidebar row seats receive `{ sessionId }`.

So the seat exists only while a session is open, and it cannot say which session. The client `sessions` service offers `scope(id)`, `retain`, `resolveTarget` and `summaries`; none of them answers "the session this composer belongs to".

Consequence: the entry has been invisible in every build, on every host version, and no test noticed because no test drives the registered callback with the payload the host actually sends.

It now reports the gap once rather than rendering nothing: `preset entry hidden: conversation.input.left is rendered without a session id, so the seat cannot scope a read`. Silent absence reads as a broken plugin, and this is a gap in the seat.

**Three ways to close it, none applied:**

1. Upstream: pass `{ sessionId }` to the composer seats. One line in `InputBar.tsx`, and the seat becomes usable for any plugin that needs it. This is the right fix and it belongs in the host, not here.
2. Move our entry to `sidebar.workspaces.session.row.action`, which does receive a session id. Wrong place for a composer control, but it works today.
3. Leave the manager reachable only from the settings section, which does render.

Until one of those lands, the preset manager has no entry point in the web UI, and the settings section is the only surface that can be reached.

## Corrected: the seat does pass a session id

The section above is wrong about the host. `conversation.input.left` is rendered with `{}` as _owner_ props, and the renderer merges a session standard kit on top: `ui-session` declares `SessionStandardProps { useSession, sessionId, useProjection, useAccess }` and the renderer adds it to every entry whose scope is `session`. Measured, not read: a temporary probe in the registration printed `seat props: ["sessionId","t","observer"] sessionId=session-6a77a7be…` on the installed runtime.

So the entry has been rendering all along, and my own searches missed it twice: it is icon-only, so no text matched, and its label on a failed read is `无法加载扩展`, so no `预设` label matched either. The DOM says it plainly, `[data-slot="conversation.input.left"] > span > button.o75Rhq_entryButton`.

What is actually wrong is smaller and real: the read fails because the session has no extension scope yet, and the control said the same thing it says for a read that broke. That is the difference between "wait" and "something is broken", and it was invisible.

It now says which one: `扩展尚未就绪，先给这个会话发一条消息` / `Extensions are not ready yet. Send a message in this session first.` The window hook already knew the cause, because the poll distinguishes `extension-session-not-found` from a broken route; it now passes the distinction to the control.

Verified in the running build: the seat button's label is the new sentence, and the generic `无法加载扩展` remains for failures that are not the scope.

Two wrong diagnoses in two rounds on one control is the useful part of this entry. Both came from reading source and grepping labels; the probe that settled it took one console line and one DOM query.

## State of the backlog after six waves

Every audit finding this repository produced has been fixed, rejected with a reason, or handed to a product decision. What remains is not engineering work:

| item | who decides | evidence on file |
| --- | --- | --- |
| CodeMirror editor weight | product | three builds measured: shipped 1,831,600 bytes, Markdown grammar dropped 1,550,862 (−15.3%), all editors to textarea 869,357 (−52.5%, loses highlighting, line numbers, bracket matching, undo keymap, tab indent) |
| resource-window surface | product | deletion typechecks with nothing else touched and moves the bundle 1,843,056 to 1,839,328 bytes (0.2%); the cost is 528 lines, two modules, 74 locale lines and a test over a screen nothing mounts |
| stowed-tab menu wording | product | the menu selects a stowed tab, and because the selected tab always renders it looks like "show"; switching away hides it again. Three options recorded |

Guards now in `check:refactor`: dead exports, duplicate function bodies, unreachable modules, twice for package contents and bundle budget, plus the theme-token allowlist in the test suite. Each was proved to reject a deliberate violation before landing.

## Dead CSS: measured, deliberately not touched

Twenty CSS modules define 308 class names. Mapping each module's classes against the identifier its importers bind gives 27 with no reference in code; `market.module.css` holds 15 of them (`pluginCard`, `pluginCardHeader`, `pluginCardTitle`, `pluginChevron`, `detailItemRow`, `detailItemOpen`, `pageEntry`, `pageView`, `grid`).

Two of those, `pageEntry` and `pageView`, also match unrelated identifiers in the repository, and the whole measurement is name-level: it cannot follow a class reached through a computed key. Deleting on that evidence risks a style that disappears somewhere nobody looked, and there is no browser in this session to check the result.

**Not acted on.** The item needs a real CSS-module parse (the identifier a file binds, then only that file's references) before it can be a gate, and a browser pass before the first deletion. Recorded so it is not rediscovered as new.
