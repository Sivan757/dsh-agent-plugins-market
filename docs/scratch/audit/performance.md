# Performance audit: dsh-agent-plugins-market

Read-only audit at dev head `3853273`. No source file was edited. Every throwaway benchmark ran from a temporary test file that was deleted after the run, and the working tree was left clean.

Axis: work the plugin does that it need not do. The earlier MCP surface toggle work is taken as done; what follows is what remains.

Two measurement notes up front, because they change how the numbers read.

- The client bundle numbers are measured by decompressing the shipped file. They are exact.
- The server numbers are measured per document and per render on this machine, then multiplied by the cadence the code states. Each finding says which is which. Nothing here is a product-latency number: no measurement includes model, network, or paint time.

## Measurement method

| Probe | What it ran | Result |
| --- | --- | --- |
| Bundle share | Parsed `client/client.js` region markers and summed bytes per module | exact byte counts per dependency |
| Compression | `zlib.gzipSync` and `brotliCompressSync` level 9 on the shipped file | gzip and brotli totals |
| Panel scan | 300 real documents of 2243 B in a temp dir, warm page cache, `readFile` then `parseFrontmatterRecord` then `parseSkillFrontmatter` | 63.3 ms per 300 documents |
| Frontmatter parse | 300 iterations of each parser on one 1704 B document | 99.6 us and 59.8 us per document |
| Market mount | Rendered the real `MarketSection` with the real `market-resource` cache and a counting `fetchOverview` | 2 overview GETs per mount |

Reproduce the scan number with any temp directory of Markdown documents. Reproduce the mount number by rendering `MarketSection` twice with the real `market-resource` module and a counting `fetchOverview`, which is what the probe did.

---

## Finding 1: the client pays 960 KB for an editor most sessions never open

**Severity: high. Measured.**

`client/client.js` is 1,826,343 bytes, 481,943 bytes gzipped and 386,750 bytes brotli compressed. Summing the bundle's own region markers by dependency:

| Dependency group               | Bytes   | Share of the 1,826,343-byte file |
| ------------------------------ | ------- | -------------------------------- |
| `@codemirror/*` and `@lezer/*` | 959,986 | 52.6 percent                     |
| `yaml`                         | 191,729 | 10.5 percent                     |
| `packages/market-ui` own code  | 516,924 | 28.3 percent                     |
| everything else                | 38,554  | 2.1 percent                      |

The single largest module is `@codemirror/view` at 320,196 bytes, 17.6 percent of the file on its own.

**Trigger.** Every page load of the settings surface. `packages/market-ui/src/ui/CodeEditor.tsx` imports CodeMirror at module scope, and three modules import `CodeEditor` statically: `packages/market-ui/src/ui/panel.tsx:17`, `packages/market-ui/src/features/instructions/InstructionsPanel.tsx:19`, and `packages/market-ui/src/features/output-styles/OutputStylesPanel.tsx:23`. The editor is only ever rendered inside a dialog a user opens to edit one document, so a session that never opens an editor still transfers, parses, and evaluates all of it.

**Why the obvious repair does not work here.** `tsdown.config.ts` declares one entry, `format: ['cjs']`, and `package.json` publishes exactly `"./client": "./client/client.js"`. The host loads that one file through its `__ModuleLoader__`. A dynamic `import()` in a CJS single-file bundle degrades to `Promise.resolve(require(...))` with no extra chunk and no bytes saved, and even a real split would have no loader for the second file. The `CodeEditor` module comment already records that CodeMirror is bundled deliberately, the way React is.

**Smallest repair with a real gain.** Two options, in order of preference.

1. Ship an auxiliary client chunk and teach the host loader to fetch it on demand. This is the only option that keeps CodeMirror. It is a host change, so it is out of this repository's hands and needs the host owner.
2. Replace CodeMirror with a lighter markdown textarea plus the host's own read-only code view for preview. A plain `textarea` costs zero bytes. The loss is syntax highlighting and bracket matching inside the document editor.

**Expected gain, estimated.** CodeMirror compresses better than average because it is repetitive, so a 52.6 percent raw share is not a 52.6 percent gzip share. Measure a real split before quoting a number. A defensible planning estimate is 180 to 250 KB of the 482 KB gzip total, that is 37 to 52 percent of what the client downloads.

---

## Finding 2: an idle session polls a route that rebuilds its whole inventory every 2.5 seconds, forever

**Severity: high. Constants measured, aggregate estimated.**

`packages/market-ui/src/features/extension-presets/use-window.ts:52-54` re-arms a `setTimeout(load, 2500)` after every completed read, for as long as the preset entry is mounted. There is no visibility check anywhere in the client: `grep -rn 'visibilitychange|document.hidden'` over `packages/market-ui/src` returns nothing, so the poll also runs while the window is in the background. The comment at line 10 states the intent, "commit events refresh immediately; polling remains the inventory fallback", but the fallback never slows down or stops.

Each poll is `GET .../extension-presets/window`, which reaches `packages/market-runtime/src/runtime/host/extension-runtime.ts:414-421`. That read does, unconditionally, every time:

- `ExtensionPresetStore.read` at `packages/market-runtime/src/application/state/extension-presets.ts:77-90`, a `readFile` plus `JSON.parse` of the workspace preset library,
- `refreshInventory`, which fans out through `packages/market-bundle/src/session-extension.ts:201-238` to project suites, user declarations, the project catalog, `catalog.mcpBackend()`, and `loadDisabledLspServers(dataRoot)` (`packages/market-lsp/src/application/lsp/lsp-server-state.ts:7-14`, another JSON file read),
- `readExtensionInventory`, whose six-way `Promise.all` at `packages/market-bundle/src/application/extension-inventory.ts:121-128` includes `panels.skills.list(true)`, `panels.commands.list(true)`, and `panels.agents.list(true)`,
- and `session-extension.ts:233` expands each of those into a user-dimension store read plus a project-dimension store read, so six strict panel reads per poll.

A strict panel read walks every document and reads its text (`packages/market-runtime/src/application/panel-resources.ts:417-424`). Measured cost per document for that read plus the two frontmatter parses: **210.9 us** (63.3 ms for 300 documents, warm page cache). Read alone is 54 us per document, so parsing is roughly three quarters of it.

**Estimated aggregate.** A workspace with 45 documents across the three surfaces costs about 9.5 ms per poll, and one with 300 documents costs about 63 ms. At 2500 ms per poll that is 24 polls a minute, continuously, whether or not anyone is looking:

| Documents in the workspace | CPU per poll | CPU per minute | Share of one core |
| -------------------------- | ------------ | -------------- | ----------------- |
| 45                         | 9.5 ms       | 228 ms         | 0.4 percent       |
| 150                        | 32 ms        | 760 ms         | 1.3 percent       |
| 300                        | 63 ms        | 1.5 s          | 2.5 percent       |

Multiply by the number of open sessions. None of this CPU produces a visible change, because most polls find nothing different.

**Smallest repair.** Three independent steps, any one of which helps.

1. Stop polling when the document is hidden and re-read once on `visibilitychange`. Free, and removes the background cost entirely.
2. Make the poll conditional on what it is for. The comment says it is the inventory fallback, so it should run only while the preset menu is open or a write has not settled, not for the lifetime of the session. Commit events already refresh immediately through `observer.subscribe`.
3. Back the poll off while nothing changes: reset the interval on a changed payload, otherwise double it up to a ceiling.

**Expected gain.** A background window with an idle session goes from the table above to zero. A visible idle window keeps a slow safety poll instead of 24 full inventory rebuilds a minute.

---

## Finding 3: the panel row cache expires before the poll that would reuse it

**Severity: high. Both constants measured, cost measured per document.**

`packages/market-ui/src/features/extension-presets/use-window.ts:54` polls every 2500 ms. `packages/market-runtime/src/application/panel-resources.ts:136` sets `ROW_CACHE_MAX_AGE_MS = 2_000`.

The cache window is shorter than the interval between the reads that need it, so on the polling path the memo at `panel-resources.ts:332-346` never hits. Every poll pays the full scan of every document, and the cache's own doc comment at lines 120-134 states the opposite intent: "to absorb one tick of the client's 1.5 s translation poll".

It absorbs the 1500 ms translation poll. It does not absorb the 2500 ms window poll, which is the one that runs for the whole session.

**Smallest repair.** Make the two numbers one decision. Either raise the poll interval to 2000 ms or below, or add a separate longer bound for reads that then revalidate. Keeping the pair as two independent literals in two packages is what allowed them to drift apart, so whichever value is chosen should be derived from the other, not restated.

**Expected gain.** Turns every second poll into a cache hit, halving the scan work from Finding 2 without changing what the user sees. The staleness bound that `ROW_CACHE_MAX_AGE_MS` documents, a hand edit visible by the next poll, is preserved as long as the chosen bound stays at or under one poll interval.

---

## Finding 4: panel stores are keyed per agent, so two sessions in one workspace scan the same files twice

**Severity: medium-high. Code-evidenced, cost measured per document.**

`packages/market-bundle/src/session-extension.ts:173-180` builds `Map<Agent, ReturnType<typeof createProjectExtensionResources>>` and calls `createProjectExtensionResources(catalog, panels, extensionWorkspace(agent))` once per agent.

`packages/market-bundle/src/application/extension-project.ts:16` turns that call into `createPanelResources(catalog, users, cwd)`, which allocates three fresh panel stores, each with its own `cached` field. The only session-varying input is `cwd`. Two sessions opened in the same workspace therefore hold two independent copies of the same row cache and scan the same files independently, and so do N sessions.

The comment above the map justifies the memo as "one reader per agent: it owns panel stores whose row caches must survive across reads". The requirement is that the reader survives across reads, which keying by workspace satisfies just as well, and it shares the cache that the comment is about.

**Trigger.** Every catalog change calls `invalidate()` on all agents (`packages/market-runtime/src/runtime/host/extension-runtime.ts:189-196`), then refreshes each of them, so a single settings toggle costs N project-dimension scans of identical files, plus N inventory fan-outs of Finding 2.

**Smallest repair.** Key `projectReaders` by workspace string instead of by `Agent`, and release an entry when no live agent names that workspace. The catalog and user stores are already shared, so nothing else changes.

**Expected gain.** Divides the per-workspace project scan cost by the number of sessions open in it. With 300 project documents and three sessions, the measured 63 ms scan becomes one 63 ms scan instead of three, on every catalog change and every poll.

---

## Finding 5: every skill is YAML-parsed twice per row

**Severity: medium. Measured.**

`packages/market-runtime/src/application/panel-resources.ts:143-157` calls both `parseFrontmatterRecord(rawText)` (`packages/market-runtime/src/application/panels/user-store.ts:199`, which runs `parseDocument`) and, when the surface is skills, `parseSkillFrontmatter(rawText, undefined)` (`packages/market-catalog/src/scanning/skills-parse.ts:87`, which runs `parseYaml`) on the same document text in the same call.

Both parse the identical frontmatter block. Measured on a 1704-byte document: `parseFrontmatterRecord` takes **99.6 us**, `parseSkillFrontmatter` takes **59.8 us**, so the second parse adds **37.5 percent** to the frontmatter work and **28 percent** to the whole per-document scan cost of 210.9 us.

**Trigger.** Every skill row on every panel scan, which per Findings 2 and 3 is every 2.5 seconds.

**Smallest repair.** Parse once and derive both views. Both functions already extract the same frontmatter block with the same regex, so a single `parseDocument` result can supply the record and the fields `parseSkillFrontmatter` validates. The lenient-fallback branch in `skills-parse.ts:93-99` must be preserved for Claude Code-authored frontmatter, which is the reason the strict and lenient paths both exist.

**Expected gain.** At 300 documents that is 17.9 ms off a 63.3 ms scan, 28 percent. The one caveat worth checking before landing it: the two parsers may disagree on malformed input, and this repository fails closed, so a merged parser must keep the strict `parseFrontmatterRecord` verdict as the authority for validity and use the skill parse only for the skill-specific fields.

---

## Finding 6: every Market tab mount issues two overview reads and throws the module cache away

**Severity: medium. Measured.**

The probe rendered the real `MarketSection` with the real `market-resource` module, then unmounted and mounted it again, counting `fetchOverview` calls. **Two GETs on the first mount, two on the second.** The cache at `packages/market-ui/src/features/market/market-resource.ts:17-31` contributes nothing on either.

The cause is an ordering collision between two lines in the same component.

1. `packages/market-ui/src/features/market/MarketSection.tsx:66-67` calls `loadOverview()` inside `useState` initializers. `loadOverview` issues its request eagerly, so the first GET starts during render.
2. `MarketSection.tsx:113-115` runs `void refresh()` on mount, and `refresh` begins with `invalidateOverview()` at `MarketSection.tsx:98`. That bumps `overviewGeneration`, sets `inflightOverview` and `cachedOverview` to `undefined`, and starts a second GET.

The render-time request is still in flight and its `.then` is guarded by the generation check at `market-resource.ts:22-24`, so its result is discarded. The module cache cannot survive a mount either, because the mount itself is what clears it. Switching from Market to another tab and back therefore always costs a full `/overview` round trip, and the "loads the last overview immediately and revalidates one shared request" contract in that function's doc comment is never exercised on the path that matters most.

**Smallest repair.** Two lines.

1. Delete `invalidateOverview()` from the top of `refresh`. Mutations already invalidate it at `MarketSection.tsx:136` and `market-resource.ts:59`, which is the only place it is needed. Make the mount path revalidate the existing cache instead of destroying it.
2. Move the eager request out of render. Read `loadOverview().initial` for state and let the mount effect be the only thing that starts a read, or latch the request behind a `useRef` so a render never issues one.

**Expected gain.** One GET instead of two per mount, and a warm cache on every repeat visit, which removes a round trip from every tab switch back to Market. This one is directly measurable with the same probe and should be gated by a test asserting a single overview read per mount.

---

## Finding 7: the `/` menu keeps re-reading its faces for a full minute after it has settled

**Severity: medium. Code-evidenced, cost measured per document.**

`packages/market-ui/src/menu-row-faces.ts:24-25` sets `MENU_FACE_REVALIDATE_MS = 1_500` and `MENU_FACE_MAX_READS = 40`. The tick loop at lines 154-163 decrements `remaining` and re-arms whenever the menu is still open, with no early stop when a read changed nothing. `refresh` computes `changed` at line 122 and uses it only to notify the open menu, never to stop the polling.

So opening the `/` menu and leaving it open for a minute produces up to 40 reads of `MARKET_ROUTES.menuRowFaces`. Each one reaches `packages/market-bundle/src/application/catalog.ts:355-378`, which reads `localePreference()` and then `ports.menuRowIdentities()`, and that in turn calls `panels.skills.list()` and `panels.commands.list()` (`packages/market-runtime/src/runtime/host/menu-row-identities.ts:50-52`), two more panel scans. The 1500 ms interval is under the 2000 ms row cache, so half of those scans are absorbed and half are not.

**Estimated cost.** 40 reads times two panel scans, with roughly half hitting the row cache, is about 40 scans. At the measured 210.9 us per document with 45 documents in the two panels that is about 380 ms of server CPU and 40 HTTP round trips, per menu opening, for a menu whose rows were already correct after the first read.

**Smallest repair.** Stop when nothing changes. Track consecutive no-change reads in `refresh`'s caller and stop after two, keeping the 40-read ceiling as the outer bound for the case where translations really are still landing. The reads exist to pick up text that arrives late, and unchanged text is proof it has not arrived yet for that row.

**Expected gain.** Takes a typical menu opening from about 40 reads to 2 or 3, which is the difference between roughly 380 ms and 25 ms of server CPU per opening.

---

## Finding 8: the window read rebuilds the inventory even when nothing is stale

**Severity: low-medium. Code-evidenced.**

`packages/market-runtime/src/runtime/host/extension-runtime.ts:421` calls `this.refreshInventory(agent)` on every window read. The runtime already holds the rows it just read in `this.resources`, and it already tracks whether they might be wrong in `this.stale` and `this.dirty` (same file, lines 189-196, 356-368). The window read consults neither before rebuilding, and it only falls back to `this.resources` when the rebuild throws, at line 433.

This is the same fan-out that Finding 2 measures, so it is not a second cost on top of it. It is the reason the poll is expensive at all: a read that answered from `this.resources` unless `stale` or `dirty` was set would make every ordinary poll nearly free and leave the expensive path to the catalog changes that actually justify it.

**Trigger.** Every window read, which per Finding 2 is 24 times a minute per session.

**Smallest repair.** Answer from `this.resources` when the agent has a cached row set and neither `stale` nor `dirty` is set, and refresh otherwise. The invariant is already maintained: `refreshInventory` publishes into `this.resources` and clears `stale` at lines 356-368, and `invalidate` sets both marks for every agent.

**Expected gain.** Removes the entire inventory fan-out from the steady-state poll, which is most of Finding 2's estimated cost, independently of the polling-cadence fix. The two repairs compose: the cadence fix reduces how often the read happens, and this one makes each read cheap.

---

## Checked and found clean

These were candidates that the code already handles, recorded so a later audit does not repeat the search.

- **The market view model is memoised.** `MarketSection.tsx:149` memoises `deriveMarketViewModel` on all four inputs. No render-time re-derivation.
- **The translator is stable.** `packages/market-ui/src/index.ts:184` binds `t` once at apply time, and the settings section and legacy page reuse that instance. The slot callback at line 172 does re-bind per slot render, but no effect or callback depends on that identity, so it causes no refetch loop. `MarketSection`'s `refresh` has `[t]` in its deps and is safe for this reason.
- **The LSP status poll is self-limiting.** `packages/market-ui/src/features/lsp/LspStatusPanel.tsx:114-138` polls at 1 s only while a row is `starting`, and stops at 20 attempts.
- **The user-dimension panel stores are shared.** `packages/market-bundle/src/index.ts:418` passes one `resources` instance to every agent, so Finding 4 is confined to the project-dimension stores.
- **The catalog snapshot cache has a keep-warm refresh and an in-flight join** (`packages/market-catalog/src/application/snapshot-cache.ts:89-145`), so the 30 s user TTL does not produce a cold first read for a panel opened minutes apart.

## Ranked follow-up list

Ordered by expected gain per unit of risk, not by severity above.

1. Finding 8, answer the window read from cached rows. Largest gain, smallest diff, and the invariant it needs already exists.
2. Finding 1, find out whether the host can load an auxiliary client chunk. Largest single number in the audit, but blocked outside this repository.
3. Finding 2, stop polling a hidden window and slow the poll when nothing changes.
4. Finding 3, derive the row cache bound from the poll interval so the pair cannot drift.
5. Finding 6, one line to stop clearing the overview cache on mount, plus a test.
6. Finding 4, key project readers by workspace.
7. Finding 7, stop menu-face revalidation after two unchanged reads.
8. Finding 5, single-parse the frontmatter, with care for the strict verdict.

## Boundaries of this audit

- No browser or paint measurement was taken. The client findings are about bytes transferred and requests issued, not about interaction latency or first paint.
- The per-document scan number depends on document size. The probe used 2243-byte documents, which is a small-to-typical skill; a panel of long documents scales up roughly linearly, and the 2243-byte figure should be treated as a floor for rule-of-thumb arithmetic rather than a constant.
- Finding 2's aggregate table multiplies a measured per-document cost by a cadence read from source. It is an estimate, not an end-to-end observation. A decisive version would instrument one real session for a minute and count the route calls and their CPU.
- Finding 5's repair touches a fail-closed validity verdict on user files. It is the one item on this list that carries a correctness risk as well as a performance one.
