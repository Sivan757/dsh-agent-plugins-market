# LSP stability: lifecycle, delay arithmetic, and the missing reason

Diagnosis of the LSP half of the stability report ("connections drop, the reason is never shown, reconnecting takes tens of seconds"). MCP is a separate report. Tree: `dev` at `c8c9938`, host baseline `@deepseek-ai/dsh-lsp*` `0.2.0-rc.2` as installed under `node_modules`.

Method: read-only inspection of this package's seam (`packages/market-lsp`, plus the mount lifecycle and the panel it feeds) and of the three published host packages the seam calls. Nothing was modified. Line numbers in `node_modules` are exact for the installed `lib/index.js` build only.

## Summary

1. **Nothing observes a running language server.** `ctx.lsp` publishes no provider snapshot, no process probe, and no event (`node_modules/@deepseek-ai/dsh-lsp/lib/index.js:61-103`). `dsh-lsp-stdio` signals a death only by rejecting the next query (`.../dsh-lsp-stdio/lib/index.js:461-474`). Our registry keeps a disposer and nothing else (`packages/market-lsp/src/runtime/lsp/lsp-mounts.ts:512`). A dead server therefore renders as `mounted` with `reason === undefined`.
2. **Recovery is query-driven, and the query budget sets the recovery cost.** A death is discovered only by the next `lsp` call, which pays a failed round trip, a teardown, a re-spawn, and a cold `initialize`. That cold start is charged to the tool-call budget (`60000` ms by default, `node_modules/@deepseek-ai/dsh-tool-lsp/lib/index.js:199`), and when the budget expires the still-initializing process is torn down (`.../dsh-lsp-stdio/lib/index.js:772-776`), so nothing is ever kept warm. A server that needs longer than the budget to initialize can never serve a single query.
3. **A failed mount waits on a timer nobody can trigger.** The retry ladder is 1.5 s, 5 s, 15 s, 45 s, 120 s (`packages/market-runtime/src/runtime/core/mount-lifecycle.ts:49`), the panel's refresh button only re-reads status, and the attempt budget never resets after a success. Fixing the cause can leave the row failed for up to 120 s, or permanently after the fifth failure.
4. **The smallest fix worth doing first** is the LSP twin of the MCP `retryMounts` action, because that pattern already exists in this tree and removes the wait entirely. The tempting two-line change, lowering the tool timeout, makes item 2 worse and must not be done alone.

## 1. Timeline of one language server

```
declaration -> reconcile -> mount (no process) -> first query -> spawn -> initialize
   -> request -> death -> nothing notices -> next query -> re-spawn -> panel still says "Mounted"
```

| # | Phase | What actually happens | Evidence | What our code can observe |
| --- | --- | --- | --- | --- |
| 1 | Declared | A suite's inline `lspServers` entry or `~/.agents/lsp.json` is read into a row. | `packages/market-lsp/src/application/lsp/lsp-direct-config.ts:22-37`, `packages/market-lsp/src/application/lsp/lsp-status.ts:100-129` | The declaration: command, args, extensions. |
| 2 | Reconcile | The wanted set is rebuilt, one provider per child plugin, and passed to `ctx.plugin`. Passes are serialized. | `packages/market-lsp/src/runtime/lsp/lsp-mounts.ts:186-188` (queue), `245-251` (one child per provider), `262-285` (mount loop) | The reconcile result, which is empty on success. |
| 3 | Mount | The child plugin resolves each executable and registers a provider on `ctx.lsp`. **No process is spawned here.** | `lsp-mounts.ts:480-503` (`handle.await()`), `node_modules/@deepseek-ai/dsh-lsp-stdio/lib/index.js:1004-1022` (resolve), `1023-1035` (register), `952-955` and `992-993` ("each process launches lazily on its first matching query") | Success or a mount error. Success is stored as `disposer` only. |
| 4 | Live mount recorded | Our registry keeps fingerprint, suite id, server keys, providers, and the disposer. | `lsp-mounts.ts:512-513` | Nothing about the child process. The handle exposes `await` and `dispose` (`packages/market-runtime/src/runtime/core/mount-lifecycle.ts:9-12`). |
| 5 | First request | The `lsp` tool calls `ctx.lsp.query`, which routes by file extension to the provider. | `node_modules/@deepseek-ai/dsh-tool-lsp/lib/index.js:350-359`, `.../dsh-lsp/lib/index.js:95-102`, `.../dsh-lsp-stdio/lib/index.js:1092-1129` | Nothing. Our plugin never calls `ctx.lsp.query`. |
| 6 | Provider start | One `LspInstance` per canonical workspace is created, spawned, and initialized. Queued behind the previous query for that workspace. | `.../dsh-lsp-stdio/lib/index.js:1143-1150`, `1156-1170`, `719`, `752-766`, `1132-1141` | Nothing. |
| 7 | Process dies | The subprocess `done` promise settles, the connection records `closeReason` with the stderr tail, pending requests reject. Only `processClosed` flips. | `.../dsh-lsp-stdio/lib/index.js:277-295`, `465-474`, `721-723`, `461-464` | **Nothing.** No listener exists on our side, and the seam emits no event. Status stays `mounted`. |
| 8 | Next query | The stale instance's `notify` rejects at once with the retained cause. The provider notices `instance.dead`, disposes, evicts, and retries **exactly once** on a fresh instance. | `.../dsh-lsp-stdio/lib/index.js:322-324`, `440`, `1115-1118`, `1111`, `1124-1127`, `1143-1150` (no dead check, by design of the retry) | Still nothing. The only copy of the reason is the error text the caller receives. |
| 9 | Restart | No explicit path exists. Recovery rides whichever of these fires first: the next query, a fingerprint change, a settings mutation, or the mount-retry ladder. | `lsp-mounts.ts:252-259` (fingerprint), `281` (retry), `packages/market-ui/src/features/lsp/LspStatusPanel.tsx:71-80` (refresh reads only) | Nothing distinct from a first mount. |
| 10 | Status shown | `mounted`, no `reason`, no `code`, no `causes`. | `packages/market-lsp/src/application/lsp/lsp-status.ts:64` | The lie the product owner sees. |

Two honest but missing observations follow from the table. First, `mounted` means "the child plugin registered, and some mount somewhere is live", not "a process exists". Second, `hasLiveMounts()` is a global boolean (`lsp-mounts.ts:457-460`), so a row with no mount of its own also renders `mounted` while any sibling is live (`lsp-status.ts:64`).

## 2. The exact delay arithmetic

All values are code constants, not measurements.

| Delay | Value | Evidence | When it applies |
| --- | --- | --- | --- |
| Tool-call budget for one `lsp` call | 60 000 ms | `node_modules/@deepseek-ai/dsh-tool-lsp/lib/index.js:199`, `202-206`, `349` | Every call. Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy`, which the standard base bundle mounts (`~/workspace/deepseek-harness/packages/bundle/base/cordis.patch.yml:409`). |
| Post-timeout teardown before the call answers | up to 7 000 ms more | `~/workspace/deepseek-harness/packages/guard/timeout-policy/src/index.ts:61-79` awaits `next()` before replacing the result, and `.../dsh-lsp-stdio/lib/index.js:772-776` tears the initializing instance down on abort | A call that expires during `initialize`. The model sees "tool call timed out after 60000ms" after up to ~67 s. |
| Cold start, per process | unbounded in the seam | `.../dsh-lsp-stdio/lib/index.js:752-766` (the `initialize` request carries no deadline) | Every spawn, including every re-spawn after a death. |
| Mount retry ladder | 1 500, 5 000, 15 000, 45 000, 120 000 ms, cumulative 21.5 s to attempt 3, 66.5 s to attempt 4, 186.5 s to attempt 5 | `packages/market-runtime/src/runtime/core/mount-lifecycle.ts:49-50`, `87-93` | After a mount failure, which includes a missing executable. |
| Give-up | the sixth `schedule` for one key logs and returns, and the key never retries again | `mount-lifecycle.ts:81-86` together with `lsp-mounts.ts:278-284` (a successful mount never calls `schedule`, so `attempts` is never cleared) | Any session that had five mount failures. |
| Teardown per instance during a restart | `shutdownTimeoutMs` 5 000 + `killGraceMs` 2 000 = 7 000 ms, then unbounded quiescence | `.../dsh-lsp-stdio/lib/index.js:979-980`, `894-901`, `913-916` | Every dispose, including the one inside a restart. |
| Cancel grace after an abort | `killGraceMs` 2 000 ms | `.../dsh-lsp-stdio/lib/index.js:828-851` | A cancelled or timed-out query whose server does not acknowledge. |
| Second concurrent `lsp` call | waits for the first call's whole budget, up to 60 000 ms | `.../dsh-lsp-stdio/lib/index.js:744-751` (instance queue) and `1132-1141` (per-workspace queue) | Two calls on the same workspace. |
| Reconcile blocked behind one slow mount | unbounded | `lsp-mounts.ts:186-188` plus `483` (`await handle.await()` has no timeout) | A mount that hangs. |
| Panel startup poll | 1 000 ms x 20 attempts, then stops | `packages/market-ui/src/features/lsp/LspStatusPanel.tsx:102-123` | A row stuck at `starting`. The verdict then freezes. |

**Composite worst case for "I fixed it, why is it still broken".** A mount failure schedules attempt 1 at 1.5 s. If the user fixes the executable and presses refresh, nothing asks the runtime to re-mount, so the row keeps its stored diagnostic until the ladder reaches the next step (up to 120 s) or an unrelated settings mutation triggers a reconcile. That is the slow path the product owner most likely hit, because the only one-click control that forces a re-mount today is the enable switch (`LspStatusPanel.tsx:84-92`, `packages/market-lsp/src/application/lsp/lsp-service.ts:108-116`). Saving an edited declaration re-runs the pass too, but it changes the declaration, which is not what a user wants after fixing an executable on disk.

**Composite worst case for "the server keeps dying".** Death, then a query, then re-spawn, then cold `initialize`. If `initialize` outlives the 60 s budget, the budget fires, the instance is torn down, and the next call repeats the whole cost. The result is a permanent 60 s loop with no reason on screen, which matches the report exactly.

## 3. What the panel shows, phase by phase

| Phase | Panel state | Localized label | Fields carrying a reason | File |
| --- | --- | --- | --- | --- |
| Declared, before the first reconcile lands | `starting` | 启动中… / Starting… | none | `lsp-status.ts:67-70`, `LspStatusPanel.tsx:356` |
| Mount succeeded, process never spawned (the normal steady state) | `mounted` | 已挂载 / Mounted | none | `lsp-status.ts:64` |
| Process alive and serving | `mounted` | 已挂载 / Mounted | none | same |
| Process died | `mounted` | 已挂载 / Mounted | **none, and none can exist in the current design** | same |
| A query failed on the dead process | `mounted` | 已挂载 / Mounted | none. The text `language server exited; stderr: …` exists only in the tool result the model receives | `.../dsh-lsp-stdio/lib/index.js:461-464`, `279` |
| Mount failed | `failed` | 失败 / Failed | `reason`, `code` (`mount-failed` or `unmount-failed`), `causes`, `retryable: true` | `lsp-status.ts:60-62`, `123-126` |
| Host package absent | `host-missing` | LSP 组件缺失 | `reason`, `code` | `lsp-status.ts:58`, `lsp-mounts.ts:540` |
| Seam taken by another layer | `conflict` | 接缝冲突 | `reason`, `code`, plus the one-click removal banner | `lsp-status.ts:59`, `LspStatusPanel.tsx:137-148` |
| Disabled by the user or the surface toggle | `disabled` | 已禁用 | none | `lsp-status.ts:56`, `121` |

So exactly one field carries a reason, `reason`, with `code` and `causes` beside it (`packages/market-contracts/src/contracts/lsp-status.ts:41-48`), and it is populated only from a mount-time diagnostic (`lsp-mounts.ts:278-284`, `lsp-status.ts:38-45`). The panel is ready for a real reason: the detail dialog already renders reason, causes, and a classified guidance sentence (`LspStatusPanel.tsx:319-321`, `packages/market-ui/src/ui/failure-guidance.ts:76-107`). What is missing is a producer, not a renderer.

Three smaller honesty problems in the same surface:

- `retryable: true` is set for every `mount-failed` row (`lsp-status.ts:61`) even after the scheduler has given up (`mount-lifecycle.ts:83-86`), so the panel can promise a retry that will not happen.
- `observedAt` is stamped with the request time, not the observation time (`lsp-status.ts:160`), and the panel never renders it. Staleness is invisible.
- The error banner's retry button reuses the MCP copy `mcpRetry` and only re-reads status (`LspStatusPanel.tsx:149`), so the control that looks like a recovery action does not recover anything.

## 4. Seam-only fixes, ranked smallest first

Every item below stays inside this repository. No host change, no new dependency.

### F1. Stop the retry budget from dying permanently (smallest)

- **Files**: `packages/market-runtime/src/runtime/core/mount-lifecycle.ts` (add `settle(key)` and call it, or delete the key's attempt count when a target mounts), `packages/market-lsp/src/runtime/lsp/lsp-mounts.ts:283-284` (call it on success), `packages/market-lsp/src/application/lsp/lsp-status.ts:61` (only claim `retryable` while the scheduler still holds budget).
- **Effort**: about 10 lines plus a unit test. Under an hour.
- **Risk**: low. It only changes timing bookkeeping. Watch the MCP registry the shared scheduler serves.
- **Proving test**: a `RetryScheduler` unit that fails five times, mounts successfully, then fails again, and asserts the sixth failure still arms a timer. Today it logs "giving up after 5 attempts" (`mount-lifecycle.ts:84`).

### F2. An explicit restart action, cloned from MCP (recommended first)

- **Files**: `lsp-mounts.ts` (add `forceRemount(keys)` and `forceRemountAll()`, and treat a forced key as fingerprint-mismatched in the loop at `252-259`), `packages/market-lsp/src/application/lsp/lsp-service.ts` (a `restart()` that flags, calls `notifyChanged(true)`, then `refreshSettled()`), `packages/market-contracts/src/contracts/market.ts` (one route constant), `packages/market-bundle/src/routes.ts` (one POST), `packages/market-ui/src/api.ts`, `packages/market-ui/src/features/lsp/LspStatusPanel.tsx` (button in the detail dialog), `packages/market-ui/src/locales.ts` (zh/en pair).
- **Why it is cheap**: the pattern already ships for MCP, including the comment that names exactly this failure (`packages/market-mcp/src/runtime/mcp/mcp-mounts.ts:113-130`, `packages/market-mcp/src/application/mcp-service.ts:326-340`, `routes.ts:526-528`, `packages/market-ui/src/api.ts:350`).
- **Effort**: about 60 lines of production code plus copy. Two to three hours.
- **Risk**: medium. A forced remount disposes the child plugin, so an in-flight query fails with `LSP_DISPOSED` (`lsp-mounts.ts:516-526`), and the request must join the serialized pass queue rather than race it. Teardown is bounded at about 7 s per live instance, so the response must answer before the pass settles, as the MCP path already does.
- **Proving test**: extend `packages/market-bundle/test/integration/lsp-mounts.test.ts` (its `mountCtx` already records disposals) with a case where `forceRemountAll()` plus one reconcile disposes the live mount and mounts a fresh one with the same config, and a second restart issued during a pass is queued rather than overlapped. A route test belongs beside the existing MCP retry case in `packages/market-bundle/test/integration/routes.test.ts:192`.

### F3. Put a real, process-level reason in the status payload

- **Files**: a `tools/execute` wrapper registered by this plugin (the host's own timeout policy proves the seam is public, `~/workspace/deepseek-harness/packages/guard/timeout-policy/src/index.ts:55-80`), which for `exec.name === 'lsp'` records the outcome and the error text against the row whose provider claims `exec.args.file_path`'s extension, `lsp-mounts.ts` (an `observations` map plus a `observe(id, outcome)` method), `lsp-status.ts` (a new optional `observation` field on the row), `packages/market-contracts/src/contracts/lsp-status.ts`, `LspStatusPanel.tsx` (one detail row), locales.
- **Effect**: after the first failing call the panel can say "the language server exited: <stderr tail>" instead of `mounted`. It also makes the retry-once behaviour visible.
- **Effort**: 80 to 120 lines. Half a day.
- **Risk**: medium-high. Wrapper ordering against the timeout policy decides whether we see `TOOL_TIMEOUT` or the transport error. The wrapper must return the result unchanged. Attribution by extension is unambiguous only because the seam rejects a duplicate extension (`.../dsh-lsp/lib/index.js:84`).
- **Proving test**: an integration test that dispatches a fake `tools/execute` event with the `lsp` name and a transport error, then asserts `buildLspStatus` reports the observation on the matching row and leaves the result object untouched.

### F4. Say what the panel can and cannot know (copy)

- **Files**: `LspStatusPanel.tsx` (a hint line under the header, and a per-row "process not observed" note), `locales.ts` (zh/en pair), `lsp-status.ts:64` only if the wording changes with it.
- **Effort**: about 15 lines plus copy. Under an hour.
- **Risk**: low. Product-facing wording, so it needs the owner's sign-off.
- **Proving test**: a render test beside `packages/market-ui/test/lsp-seam-render.test.ts` asserting the hint renders in both locales.

### F5. Per-row liveness instead of the global flag

- **Files**: `lsp-mounts.ts` (`liveKeys(): ReadonlySet<string>` beside `hasLiveMounts()`), `lsp-status.ts:64` (membership test instead of `anyLive`), the port in `packages/market-contracts/src/ports/ports.ts:161`.
- **Effort**: about 15 lines plus updates to the fakes that stub `lspStatusSource` in five test files.
- **Risk**: low, but it fixes a different bug than the reported one. A dead process keeps its live mount, so this change does not make that row honest. It only stops a row with no mount of its own from borrowing a sibling's health.
- **Proving test**: two suites, one live, one not, asserting the second reports `starting` rather than `mounted`.

### Withheld: lowering the tool timeout

Passing `{ timeoutMs: 15000 }` at `lsp-mounts.ts:350` is four lines, and it was my first candidate. Do not ship it alone. Because a budget expiry tears down the still-initializing process (`.../dsh-lsp-stdio/lib/index.js:772-776`), a shorter budget converts a slow server into a server that can never start, and it lengthens the loop rather than shortening it. If the budget is touched at all, raise it (for example 120 000 ms, matching the last retry step) and pair it with F2 so a wedged process can still be replaced on demand.

### What no seam-only change can do

Nothing in this plugin can pre-warm a language server. The host spawns one process per canonical workspace on the first matching query (`.../dsh-lsp-stdio/lib/index.js:952-955`, `992-993`), and a mount-time reconcile has no workspace to offer. So the seam can bound the wait, explain the wait, and let the user act now. It cannot make `initialize` faster, and reporting that honestly is part of the fix.

## 5. Not verified

- **That the running profile actually carries `@deepseek-ai/dsh-tool-call-timeout-policy`.** Verified only that the standard base bundle mounts it (`packages/bundle/base/cordis.patch.yml:409`). Without it, a hung `lsp` call is unbounded rather than 60 s.
- **Any real wall-clock measurement.** Every number above is a code constant. No system was run, no language server was started, and no timing was captured. In particular the cold-start cost for a given server on a given repository is unknown.
- **Whether a death that happens while no query is in flight leaves any trace at all.** I read no such trace, but I did not instrument a process to prove its absence.
- **Whether `@deepseek-ai/dsh-subprocess` emits any lifecycle event** an observation fix could subscribe to. A search of the installed package and of the harness sources found none, so F3 assumes the `tools/execute` event is the only hook.
- **Host behaviour under `AbortSignal` fusion when the provider lifetime aborts during a spawn** (`.../dsh-lsp-stdio/lib/index.js:1089-1091`). Read, not exercised.
- **The exact ordering between our future `tools/execute` wrapper and the timeout policy wrapper.** Both are `tools/execute` listeners, and cordis listener order was not verified.
