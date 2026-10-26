# Agent Note: the entry's fiber disposal waits for the runtime's teardown

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

The disposer runs in this order: set the entry's own `disposed` flag, stop the reconcile scheduler (its flags change synchronously, and it returns the pass it had in flight), disarm the background source updater, release the settings namespace and corpus cache state, await `runtime.dispose()`, then await the scheduler's in-flight pass. The runtime goes before the scheduler join so its own stop flag makes a queued pass bail instead of blocking that join.

The three siblings that were checked and left synchronous are `MarketSettingsNamespace.dispose()` (releases watchers), `SourceAutoUpdater.dispose()` (disarms the interval) and `Catalog.dispose()` (forwards to the translation and snapshot caches, both of which cancel their own timers).

Test temp roots under `os.tmpdir()` now go through `removeTempRoot` in `packages/market-bundle/test/integration/helpers/temp-root.ts`, which passes `maxRetries: 5, retryDelay: 20` to `fs.rm` the way `packages/market-translation/test/translation-localizer.test.ts` already did. The retry absorbs handle-release lag after an awaited teardown. It is not what makes the teardown correct: a writer that outlives the fiber still fails after the budget runs out, which is the signal the test is supposed to give.

## Consequences

A profile reload or host shutdown now waits for the runtime's mounts to unmount, bounded by each bridge's own close path, instead of returning immediately. In exchange, "unloaded" means this plugin can no longer write under the data root, so a caller that removes that root next, a test teardown, a profile reload, or an uninstall, is not racing the plugin.

The integration temp roots stop depending on how fast Windows releases a directory entry. An unawaited writer is still a failure: 5 retries of 20 ms cannot cover a fiber that never finished.

## Alternatives considered

**Keep the fire-and-forget call and only add retries to the teardown.** The retry would absorb the race in this test and leave every other consumer of the data root exposed: a profile reload, an uninstall, or a host shutdown would still return while the plugin still writes. It also converts a real defect into a timing-dependent pass, which is the failure mode the note exists to prevent.

**Poll or sleep in the test's `afterEach` until the tree stops changing.** A wait for an unspecified writer cannot distinguish a slow teardown from a leaked one, and the ordering the test needs belongs to the plugin, not to one test's cleanup.

**Make the entry's disposer await every sibling too, by widening their signatures.** Checked first: the settings, auto-update and catalog disposers are synchronous and leave no timer armed, so there was nothing to await.

**Await the runtime's disposal inside the reconcile scheduler's dispose so the entry keeps returning immediately.** The scheduler does not own the mounts; the fiber's own unload is the only point where Cordis, the test, and the loader all agree that the plugin is done.

## Testing

`host-service-seam.test.ts` adds "finishes the runtime teardown before the entry fiber reports unloaded". The case holds the runtime's disposal open behind a gate and asserts two things: the entry's `dispose()` promise has not settled while that gate is closed, and the write the teardown performs under the temp data root is on disk after `await entry.dispose()`. Reverting the disposer to `void runtime.dispose()` fails the case at the first assertion, so the shape that caused the flake cannot pass it.

What the case cannot catch: a teardown path that is itself fire-and-forget inside the runtime, which today includes `TranslationLocalizer.dispose()` calling `void this.flush()` and `SourceAutoUpdater` letting an in-flight source refresh finish on its own, and Windows releasing a handle after an awaited teardown, which the retry budget absorbs rather than proves.
