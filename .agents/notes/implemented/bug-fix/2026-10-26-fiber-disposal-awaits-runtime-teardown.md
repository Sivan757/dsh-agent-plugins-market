# Agent Note: the entry's fiber disposal waits for every teardown it starts

Status: implemented

## Problem

The marketplace entry returns from `apply()` while the runtime it built keeps working. One reconcile pass is queued behind it, every stdio MCP mount creates its `${PLUGIN_DATA}` directory under the plugin data root before its server connects, and unmounting disposes a bridge and waits for the child process that bridge started. The lifecycle effect's disposer started that work and returned: `void runtime.dispose().catch(...)`. Cordis then reported the fiber unloaded while the runtime was still using the data root, because a disposer that returns nothing is complete by definition.

The symptom was intermittent and reached the test gate rather than a user, on the job that exercises Windows. `windows` failed on `108b3a6` twice, run 40271411304 (pull_request) and run 40271047459 (push), with the same test and the same error, and on `cdf8736d`; the same range passed on `7e8e1eb`, `dc5a9e7`, `dca46d2`, `375524d`, `ded5123` and `e9788490`. The failing code was the `afterEach` of `packages/market-bundle/test/integration/host-service-seam.test.ts`:

```text
Error: ENOTEMPTY: directory not empty, rmdir C:\Users\RUNNER~1\AppData\Local\Temp\market-host-service-HDAsRy\agent-plugins
```

`fs.rm` walked that temp root while the runtime was still writing under it. Windows deletes a file whose handle is open by marking it delete-pending, so the entry stays visible for a moment and `rmdir` answers `ENOTEMPTY` for a directory the same call just emptied. A POSIX host removes the entry at once, which is why one platform reported it and why it read as a Windows problem instead of a lifetime problem.

The window widened with the two changes in flight when the failures started. PR #131 runs hook commands from disposal, and PR #132 made unmounts parallel. Neither created the defect: the fire-and-forget call arrived with the private domain workspace split on 2026-10-08.

## Decision

The entry's lifecycle effect returns an async disposer that awaits the runtime's teardown. Cordis awaits the promise a collected disposer returns (`Fiber._unload` awaits each one), so the fiber reaches unloaded only after its mounts are gone.

Every disposer on the way out follows one rule: it cancels what has to stop synchronously and returns the promise of the work it started. A caller that awaits it therefore knows no write is still coming.

The entry's lifecycle effect applies the rule to four things. It sets its own `disposed` flag, stops the reconcile scheduler (its flags change synchronously, and it returns the pass it had in flight), disarms the background source updater (synchronously, and it returns a pass that was already refreshing sources), releases the settings namespace, then awaits the runtime's teardown, the catalog's teardown, the scheduler's in-flight pass and the source-update pass. The runtime goes first so its own stop flag makes a queued reconcile bail instead of making the scheduler join wait for it.

Three writers sit behind that list, and each one now hands its promise to the caller above it:

- `ReconcileScheduler.dispose()` returns the pass it had in flight. A pass creates every stdio mount's `${PLUGIN_DATA}` directory and mounts servers.
- `Catalog.dispose()` awaits `TranslationService.dispose()`, which awaits `TranslationLocalizer.dispose()`, which returns `flush()`. That flush writes `translation-cache.json` under the plugin data root whenever a completed provider call left the cache dirty. `SnapshotCache.dispose()` stays synchronous: it only clears its keep-warm timer.
- `SourceAutoUpdater.dispose()` returns the refresh pass it found running. That pass clones source checkouts and commits state under `<userRoot>/agent-plugins/.sources`, so a fiber that reported unloaded first left it writing there.

Only `MarketSettingsNamespace.dispose()` stays synchronous with nothing to return: it releases watchers and arms nothing.

Test temp roots under `os.tmpdir()` now go through `removeTempRoot` in `packages/market-bundle/test/integration/helpers/temp-root.ts`, which passes `maxRetries: 5, retryDelay: 20` to `fs.rm` the way `packages/market-translation/test/translation-localizer.test.ts` already did. The retry absorbs handle-release lag after an awaited teardown. It is not what makes the teardown correct: a writer that outlives the fiber still fails after the budget runs out, which is the signal the test is supposed to give.

## Consequences

A profile reload or host shutdown now waits for the runtime's mounts to unmount, bounded by each bridge's own close path, instead of returning immediately. In exchange, "unloaded" means this plugin can no longer write under the data root or the user root, so a caller that removes either next — a test teardown, a profile reload, or an uninstall — is not racing the plugin.

The localizer's and the updater's own callers changed with them. `TranslationService.dispose()` and `Catalog.dispose()` return promises, so every caller that disposes a catalog awaits it; the entry's teardown reports a failing one through `ctx.logger` and keeps draining the rest, the same way it reports a failing runtime teardown. `SourceAutoUpdater.dispose()` keeps its interval disarm synchronous, so a caller that stops the updater without awaiting it still stops the ticks; only the join on an in-flight pass is new.

The integration temp roots stop depending on how fast Windows releases a directory entry. An unawaited writer is still a failure: 5 retries of 20 ms cannot cover a fiber that never finished.

## Alternatives considered

**Keep the fire-and-forget call and only add retries to the teardown.** The retry would absorb the race in this test and leave every other consumer of the data root exposed: a profile reload, an uninstall, or a host shutdown would still return while the plugin still writes. It also converts a real defect into a timing-dependent pass, which is the failure mode the note exists to prevent.

**Poll or sleep in the test's `afterEach` until the tree stops changing.** A wait for an unspecified writer cannot distinguish a slow teardown from a leaked one, and the ordering the test needs belongs to the plugin, not to one test's cleanup.

**Make the entry's disposer await every sibling too, by widening their signatures.** Done in a follow-up change once the two that really start asynchronous writes were known: the localizer's flush and the updater's in-flight refresh. The settings namespace had nothing to await, so it stayed synchronous.

**Leave the localizer and the updater fire-and-forget because their writes are rare.** They fire exactly when a call or a tick happened to be in flight at unload, which is when a teardown is most likely to be racing them: a test that translated, a profile reload during a background refresh. Rarity is what makes such a race intermittent instead of reproducible.

**Await the runtime's disposal inside the reconcile scheduler's dispose so the entry keeps returning immediately.** The scheduler does not own the mounts; the fiber's own unload is the only point where Cordis, the test, and the loader all agree that the plugin is done.

## Testing

Four cases pin the rule, each by holding the work open behind a gate and asserting the caller had not settled while the gate was closed. Every one was observed failing when its await is removed and passing once restored.

- `host-service-seam.test.ts` "finishes the runtime teardown before the entry fiber reports unloaded" gates `RuntimeReconciler.prototype.dispose`. Reverting the entry's disposer to `void runtime.dispose()` fails it.
- `host-service-seam.test.ts` "finishes the catalog teardown before the entry fiber reports unloaded" gates `Catalog.prototype.dispose`. Reverting that one line of the entry to `void catalog.dispose()` fails it, which is what proves the wiring and not only the catalog's own promise.
- `translation-dispose.test.ts` "settles only after the cache write it started landed" mocks `saveTranslationCache` and holds it open. Reverting `TranslationLocalizer.dispose()` to `void this.flush()` fails it. The file's second case pins that a clean localizer writes no cache file at all, so the first case is not passing on a write that would have happened anyway.
- `source-auto-update.test.ts` "settles only after the pass already running finished its write" holds a refresh pass open and also asserts the interval stopped. Reverting `SourceAutoUpdater.dispose()` to a void disarm fails it.

Each case reads its gate as `Promise.resolve(caller())`, so a disposer that returns nothing reads as complete the moment it returns rather than throwing on `.then` of `undefined`.

What these cases cannot catch: a translation that lands after disposal has already settled. `TranslationLocalizer` writes such an answer immediately through `scheduleFlush`'s disposed branch, deliberately, so a paid provider call is not dropped on unload; no owner can await work that starts after its teardown returned. The remaining unwatched writer is therefore "a provider call completing after unload", which is a property of that design choice rather than of a disposer. Also not provable here: Windows releasing a handle after an awaited teardown, which the retry budget absorbs rather than proves.
