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
