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
