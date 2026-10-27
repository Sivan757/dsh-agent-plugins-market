# Agent Note: Measured client and host read costs

Status: implemented

## Problem

The performance audit in `docs/scratch/audit/performance.md` measured five costs that ordinary use paid for no user-visible benefit. Each one is a number rather than an impression:

- every Market tab mount issued two overview reads, and the module cache never survived a remount,
- the row cache expired 500 ms before the poll that needed to reuse it, so a poll rescanned every document while the cache's own contract said it absorbed that poll,
- every skill row parsed the same frontmatter twice,
- project panel stores were keyed by session while the project directory was the only input that varied, so two sessions in one workspace scanned the same files twice and shared nothing,
- the extension-window poll re-armed unconditionally, so a hidden window kept asking the host to rebuild a whole inventory every interval with nobody reading the answer.

## Decision

### One overview read per Market mount

`packages/market-ui/src/features/market/market-resource.ts` gains `peekOverview`, a pure read of the cached answer that starts nothing. `MarketSection` seeds its state from that during render, so render never races the mount effect that owns the request. `refresh` takes a `force` flag and invalidates only when the caller knows the stored answer is no longer the answer: a mutation landed, or the locale the server resolves text for changed. Mounting is not such a caller.

The generation guard in `loadOverview` is what made the old pair of reads silent: the render-time request was still in flight when the effect cleared the cache, so its answer was discarded by design and a second request replaced it.

### One cadence contract for the row cache

`packages/market-contracts/src/contracts/refresh-cadence.ts` now owns `EXTENSION_WINDOW_POLL_MS` and `TRANSLATION_POLL_MS`, and derives `ROW_CACHE_MAX_AGE_MS` from them. The bound sits strictly between the two polls, and both edges are visible to a user:

- it must outlive the translation poll, or the cache never absorbs the reads it exists for,
- it must expire before the window poll, or a hand edit to a document on disk stays invisible for two polls instead of one.

`rowCacheMaxAgeMs` refuses a triple that cannot hold both, and it runs at module load, so a future cadence change fails loud instead of shipping a bound that silently stops absorbing or silently starts hiding edits. The derived value is the 2000 ms the panel already used, so behaviour is unchanged and the relation is now enforced rather than described.

### One frontmatter parse per skill row

`skillFieldsFromRecord` in `packages/market-catalog/src/scanning/skills-parse.ts` derives a skill's fields from a record a caller has already parsed. `parseSkillFrontmatter` keeps its own parse and its lenient recovery for Claude Code-authored frontmatter, and is still what discovery uses. A panel row now parses once through the strict reader and derives the skill fields from its result.

The strict verdict stays the authority. A document the strict parse rejects sets `disabled` with its validation error, which invocation flags could not change, so the derived fields are never consulted for a document that failed to parse.

### One project reader per workspace

`packages/market-bundle/src/application/project-readers.ts` holds one reader per workspace, and `session-extension.ts` keys it by the workspace instead of the agent. A reader is built lazily, so a session that never opens a panel costs nothing, and it is released when no live agent names that workspace, so a closed session cannot pin its scans.

### The window poll pauses while hidden

`use-window.ts` schedules the next read only when the document is visible, and a `visibilitychange` listener resumes a paused poll with exactly one read. A window that was never hidden keeps its armed timer, so a focus change cannot add a read. The interval itself is unchanged: the audit measured the cadence as correct for freshness and the rebuild as the cost, and moving the cadence would relocate the cost rather than remove it.

## Measured before and after

Same machine, same harness shape, before and after on this branch.

| Measurement                                        | Before                | After                      |
| -------------------------------------------------- | --------------------- | -------------------------- |
| Overview reads, first Market mount                 | 2                     | 1                          |
| Overview reads, Market remount                     | 2                     | 1                          |
| Frontmatter work per skill document                | 81.7 us               | 40.7 us                    |
| One 300-document skill scan, best of five          | 164.5 us per document | 105 to 121 us per document |
| Scans for two sessions reading one workspace       | 2                     | 1                          |
| Window reads over four intervals, document hidden  | 5                     | 1                          |
| Window reads over four intervals, document visible | 5                     | 5                          |
| Window reads on becoming visible again             | not applicable        | 1                          |

The frontmatter row is a paired run in one process, interleaved in five rounds and taken best-of, because the end-to-end scan is dominated by file reads and varies between runs. The percent saving on the frontmatter portion is the attributable number, and the scan row is the same change seen through the whole read.

## The visible poll's inventory rebuild stays

`ExtensionRuntime.window` rebuilds the whole inventory on every read, which the audit recorded as an unclaimed finding. It was measured rather than assumed, and it stays, because skipping it cannot be done without changing what a reader sees.

Measured on a 60-document panel set across three surfaces, with each read placed one poll interval after the last so the row cache is genuinely expired:

| Scenario                               | Inventory reads | Cost                               |
| -------------------------------------- | --------------- | ---------------------------------- |
| Nothing changed, four polls            | 4 of 4          | 22 to 94 ms per poll, median 45 ms |
| One suite toggled, next poll           | 1               | 15 to 119 ms                       |
| The same read with the rebuild skipped | 0               | 0.2 to 1.2 ms                      |

The skip is a 98 percent cut on the steady state, which at 24 polls a minute is about 1.1 seconds of CPU per minute per session. It is not taken, for one reason.

`stale` is set by every in-process catalog change, so gating on `stale` and `dirty` loses nothing there. What it loses is an edit to a document on disk. `PanelResources.scan` re-reads the text of every declared document on each scan (`packages/market-runtime/src/application/panel-resources.ts:417-424`), derives `description` and `disabled` from it, and `readExtensionInventory` carries those into the preset manager's rows as `description`, `available` and `globalEnabled` (`packages/market-bundle/src/application/extension-inventory.ts:297-328`). The poll at 2500 ms always outlives the 2000 ms row cache, so that re-read is the only path by which a hand-edited frontmatter field reaches the manager, and it does so within one poll interval.

Gating would move that from one poll interval to the next in-process catalog event, which may never come. A stale flag cannot see the filesystem, and no bound that matches the poll interval can help: the poll re-arms only after its read completes, so consecutive polls are already more than one interval apart and every one of them misses any bound set to the interval.

The design that would keep the freshness is a fingerprint guard rather than a stale-flag guard: `stamp` already stats every row it produced, so a scan could compare those modification times first and re-read only the documents whose stamp moved. That preserves one-poll visibility exactly, at the cost of a new freshness key inside the panel store that all three surfaces depend on. It is a larger change than the rest of this wave and is left as a follow-up with this measurement rather than landed here.

## Alternatives considered

- **Seed Market state from `loadOverview()` and let the effect join the in-flight request** was rejected because it only works while the request is still in flight. Once it lands, the effect starts a second one, which is the reported defect. Render has to not start the request at all.
- **Skip the window's inventory rebuild when nothing is stale** was rejected because it hides a hand-edited document until the next catalog event, and the poll is the only path that re-reads an already-discovered document. Measured above.
- **Keep `ROW_CACHE_MAX_AGE_MS` a literal with a comment about the cadence** was rejected because that is exactly the state that drifted. A comment cannot fail, and the two numbers lived in different packages with nothing tying them together.
- **Derive the bound from the window poll alone** was rejected because the window poll is not the only reader. The translation poll at 1500 ms was already inside the old bound and would have fallen outside a bound derived only from the slower cadence. `rowCacheMaxAgeMs` therefore checks both edges, and a future simplification that keeps only the window edge silently drops the 1500 ms poll out of the bound.
- **Raise the window poll interval instead of shortening the cache** was rejected because it moves the cost rather than removing it. The poll interval is a freshness policy, and the audit measured the rebuild as the expense.
- **Merge the two parsers into one** was rejected because they disagree on purpose. The strict reader is the validity authority and the skill parse carries a lenient recovery for authored frontmatter that strict YAML rejects, so one parser would have to accept malformed documents everywhere or reject them everywhere.
- **Key project readers by workspace and never release them** was rejected because a closed session would pin its scans for the life of the process. Release is conditional on no other live agent naming the workspace, which keeps a shared reader while it is still shared.
- **Stop the window poll entirely and rely on commit events** was rejected because the poll is the documented inventory fallback. Commit events cover a selection change, not a catalog change that arrives without one.

## Consequences

A mount, a poll, a scan, and a session's share of a workspace now cost what the work needs rather than a multiple of it. The trade-offs:

- A hidden window no longer polls, so a panel left in a background tab shows a stale inventory until it is visible again. The resume read happens before the reader can act on what they see.
- The row cache bound is now a consequence of the two cadences rather than a tunable. A deployment that wants a different staleness bound has to change a cadence, which is the honest coupling.
- A workspace reader is shared, so a panel store's caches are now amortized across sessions rather than private. The stores hold no session state, which is why sharing is sound.
- The strict frontmatter verdict now also decides whether skill fields are derived, so a document that parses strictly is the only one whose invocation flags are read from that path.

## Testing

`packages/market-ui/test/market-overview-reads.test.ts` counts overview requests through a counting fetch, so one read per mount is an assertion rather than a wall-clock measurement.

`packages/market-ui/test/extension-window-poll.test.ts` drives the real hook under fake timers with `document.hidden` stubbed, and counts reads while visible, while hidden, on resume, and after the panel unmounts.

`packages/market-runtime/test/row-cache-cadence.test.ts` pins the derived bound, the two edges it must satisfy, the refusal of a schedule that violates either, and that a read inside the bound reuses the scan while a read past it rescans.

`packages/market-bundle/test/integration/project-readers.test.ts` counts scans as `stat` calls, because a scan stamps every row it produced. Two sessions in one workspace produce one scan, a workspace still in use keeps its cache when one session leaves, and the last session leaving lets the next one rescan.

## Verification

The five measured numbers above were reproduced on this branch with throwaway probes that were removed before the commit. The permanent tests assert the mechanism, so a later change that reintroduces a double read fails on any machine rather than only when someone re-measures.

Gates: typecheck, lint, format check, and the full unit suite (256 files, 2429 tests) pass on the branch.
