# Test quality audit

Scope: `packages/**/test`, 252 files and 2416 cases at `99c304c` (the audit started on `3853273`; the tree moved while it ran, so every line number here was re-checked against `99c304c`). Skill: `dsh-ci-test-reliability`.

Ranked by what a real regression could slip past. The first three are proven the only way that settles the question: break the production line in a scratch copy under `/tmp/audit-repo` and watch the suite stay green.

The method: copy the repository (excluding `node_modules`, sharing it by symlink), apply one mutation per case, run the full suite. A mutation that leaves `252 passed` means no test asserts that behaviour. Every mutation is listed with its observed result.

## F1 - CRITICAL - the containment rejection in `pathContainmentError` is never exercised

**The assertion or scenario.** `pathContainmentError` rejects in two places: a path not starting `./` (`packages/market-catalog/src/scanning/validate.ts:159`) and a path that resolves outside the root (`:173-176`). The only test that calls it, `packages/market-bundle/test/integration/discovery.test.ts:263-266`, passes `'../escape'`. That input stops at the first branch, so the second branch - the one that catches `./../escape`, a traversing `cwd`, and a skill directory symlinked outside the plugin root - has no test at all.

**Mutation.** Removed the `isWithin` check at `validate.ts:173-176` and returned `undefined` unconditionally. Full suite: **252 files, 2416 tests, all passed, exit 0.** Restored, tests still pass.

**What would break without it failing.** Deleting, inverting or mis-typing the containment comparison lets a plugin manifest point its stdio `command`, its `cwd`, or a skill candidate outside the plugin root. The three production call sites are `validate.ts:406` (stdio `command`), `validate.ts:416` (stdio `cwd`), and `packages/market-catalog/src/scanning/surfaces.ts:83` (a `skills/` child whose `SKILL.md` realpath escapes). A suite installed from an untrusted source could then read and run a binary outside its own checkout, and this is spec §4.1 boundary 3.

**Smallest strengthening.** Three table rows, one per call site, reusing the same shape as the existing case. The unit rows alone are enough for the branch:

```ts
it.each(['./../escape', './a/../../escape'])('rejects %s, which resolves outside the root', async value => {
  expect(await pathContainmentError('/tmp/root', value)).toContain('resolves outside')
})
```

Then one integration row: a `mcp.json` whose `cwd` is `./../outside` must produce an error rather than a server.

**Cost of leaving it.** This is the only vacuous verdict on a containment path the audit found. The primitives below it are well covered (`isWithinUnder` has 14 win32/posix rows and its mutation fails 9 cases; the archive symlink walk's mutation fails `zip-bomb.test.ts`). The gap is exactly at the use site, which is where a refactor edits first.

## F2 - HIGH - the hook-bridge remount guard has no test

**The assertion or scenario.** `packages/market-runtime/src/runtime/surfaces/hooks-mounts.ts:71` skips a suite whose config fingerprint has not changed, so reconciling the same suite twice does not tear the bridge down and build it again.

**Mutation.** Replaced that line with a comment (no memo, so every pass unmounts and remounts). Full suite: **252 files, 2416 tests, all passed.**

**What would break without it failing.** `HooksMountRegistry.reconcile` runs on every catalog change and every surface toggle (`packages/market-runtime/src/runtime/core/reconciler.ts:230`, inside `reconcileSnapshot`). With the memo broken, each pass disposes the live hook bridge and mounts a new one, which rewrites the temp `hooks.json` (`hooks-mounts.ts:100-103`, a `mkdtemp` plus `writeFileAtomic`) and restarts the bridge's own state. In production that is churn on a path that also arms retries; in tests it is the churn that shows up as a flake, not a failure.

**Smallest strengthening.** One case in `packages/market-bundle/test/integration/project-hooks.test.ts`, next to the existing reconcile cases: reconcile twice with the same suite and count `plugin()` calls on the fake mount context - the second reconcile must call it zero times. Its mutation is the line above.

**Cost of leaving it.** A regression here is silent. It costs CPU, spawns processes, and reintroduces exactly the teardown-race shape the release is trying to keep closed.

## F3 - HIGH - `RetryScheduler.clear()` is never called by any test

**The assertion or scenario.** `packages/market-runtime/src/runtime/core/mount-lifecycle.ts:99-103` cancels every pending retry timer and drops every attempt budget. Both mount registries call it from their top-level disposal: `packages/market-mcp/src/runtime/mcp/mcp-mounts.ts:311` and `packages/market-lsp/src/runtime/lsp/lsp-mounts.ts:536`. No test file imports `RetryScheduler`, `mount-lifecycle`, or `SerialPassQueue`.

**Mutation.** Made `clear()` a no-op. Full suite: **252 files, 2416 tests, all passed.** The four mount-related files run on their own also pass (58/58).

**What would break without it failing.** Two behaviours, both consequential. A pending retry (armed at 1.5s, 5s, 15s, 45s, 120s by `RETRY_SCHEDULE_MS`, `mount-lifecycle.ts:49`) would survive teardown and call `replay()` after the registry was disposed, re-mounting a server the plugin had just reported unloaded - the same class of write-after-disposal the latest release fixed for the entry disposer. And a budget that never resets stops retrying a server after five cumulative failures, including failures from unrelated reconciles.

**Smallest strengthening.** A direct test of the class, since no test owns it: schedule two retries with vitest fake timers, call `clear()`, advance past every delay, and assert the `replay` spy was never called and `schedule()` after `clear()` starts again at attempt 1. That is 15 lines and it pins both halves.

**Cost of leaving it.** The timer is `unref`'d (`mount-lifecycle.ts:94`), so a leaked retry never keeps the process alive and never shows up as a hang. It shows up as a server answering after teardown, which is the hardest kind of bug to attribute.

## F4 - HIGH - two assertions that cannot fail

**The assertion or scenario.** `packages/market-bundle/test/integration/prompt-injection-conventions.test.ts:319-320`:

```ts
expect('Session extension selection request.').not.toContain(SYSTEM_REMINDER_OPEN)
expect('Session extension readiness restored.').not.toContain(SYSTEM_REMINDER_OPEN)
```

Both sides are string literals. Neither expression reads the production code, so neither can fail for any change to it. The case's comment ("a frame added here would change that text and fail there first") points at `extension-hooks-metadata.test.ts:88-90`, which asserts on literals too - so the claim is true only in that both would move together, which is exactly the coupling a reader would assume away.

**What would break without it failing.** The producers it claims to guard, `extension-session-state.ts:793` and `:843`, can be framed at any point and this file says nothing. The real behaviour (only a metadata message never opens a frame) is covered elsewhere, so the risk is not lost coverage but a false sense of it: a reader who sees "conforming producers stay plain" stops looking.

**Smallest strengthening.** Either delete the two lines, or assert on the production strings by reading the module and matching the literal, the way the same file's "no plain-prose producer imports the frame module" case at `:303-309` already does for four files.

**Cost of leaving it.** This is the second assertion of this shape the repository has shipped. The first, `toContain('</system-reminder>')`, passed for any non-empty output. Leaving another one tells the next reviewer the check exists.

## F5 - MEDIUM - a `toBeTruthy` where the case names a specific value

**The assertion or scenario.** `packages/market-bundle/test/integration/catalog-description-localization.test.ts:247`. The case is "keeps the panel usable when the provider fails", its comment says the read "still answers with upstream text", and the assertion is `expect(overview.suites[0]?.description).toBeTruthy()`.

**What would break without it failing.** Any non-empty description passes, including a partially translated one, a corrupted one, or the wrong suite's. The fixture is a fixed string (`SUITE_DESCRIPTION = 'A portable v1 suite'`, `:46`), so the case can assert it exactly.

**Smallest strengthening.** `expect(overview.suites[0]?.description).toBe(SUITE_DESCRIPTION)`.

**Cost of leaving it.** A failed-batch path that wrote a wrong description into the row ships green, and that row is what every panel renders.

## F6 - MEDIUM - a 45 ms wall-clock bound with 5 ms of slack

**The assertion or scenario.** `packages/market-bundle/test/integration/resource-filter-budget.test.ts:137`, in the zero-budget case: the stub change pipeline sleeps 50 ms (`:124`) and the assertion is `expect(waitedMs).toBeLessThan(45)`. The margin between "answered without waiting" and "waited for the pass" is 5 ms of scheduler time, measured with `performance.now()` on a shared runner. The Windows job runs this same file.

**What would break without it failing.** Nothing - this is the flake direction. Under load the 0-budget path can take more than 45 ms to return without ever awaiting the pass, and the case fails for a correct implementation.

**Smallest strengthening.** Hold the pass behind a deferred instead of a sleep, and assert structurally: `settled` is still false when `setSurface` resolves, then release the deferred. The budget parameter is already the subject, so the timing assertion can be dropped once the ordering is proven. That is the technique the new disposal cases in `host-service-seam.test.ts` use.

**Cost of leaving it.** One intermittent red on the Windows job, indistinguishable at a glance from a real budget regression.

## F7 - MEDIUM - a loop guard that tolerates seven emissions

**The assertion or scenario.** `packages/market-bundle/test/integration/extension-tool-gates.test.ts:262`, under the case named "owns dynamic definitions before tools/change and never loops on restriction notifications": `expect(count).toBeLessThan(8)`, where `count` is the number of `tools/change` events recorded before two `refresh()` calls.

**What would break without it failing.** A restriction refresh that emitted repeatedly - six times per call, say - passes. The real claim is made by `expect(changes).toHaveBeenCalledTimes(count)` on the next line, which is exact; `toBeLessThan(8)` adds nothing except a ceiling high enough not to notice a bounded loop.

**Smallest strengthening.** Replace it with the exact expected count of the setup's own registrations (or drop it, since the next line is the assertion that matters).

**Cost of leaving it.** A feedback loop between `restrict` and `tools/change` is the failure this case exists for, and the guard as written cannot see it below seven iterations.

## F8 - LOW - an inert helper whose documentation describes production ordering

**The assertion or scenario.** `packages/market-bundle/test/integration/extension-hooks-session-end-ordering.test.ts:150` returns `close: () => {}` documented as "The production teardown: the owner's dispose closes the mount flag itself". The case at `:161` calls `h.close()` and comments that the owner "disposes the hook bridge first". The call does nothing.

**What would break without it failing.** The assertion that follows is real: `contributors.dispose` must run `SessionEnd` (`:163`), and the second case at `:166` proves the fiber-unwind path. So no behaviour is unguarded. The defect is the narration: a reader believes the case exercises an ordering between two teardowns that it does not.

**Smallest strengthening.** Delete `close` and the `h.close()` call, or make it the real thing (close the grant set, then assert `SessionEnd` still ran because the bridge closed first).

**Cost of leaving it.** Small. It is recorded because the same file states its boundary carefully everywhere else, and one decorative step teaches the wrong lesson about what the case proves.

## Verified strong, so a later pass does not re-propose them

Each was checked by mutation or by reading, and each is a real assertion.

| Behaviour | Where | Evidence |
| --- | --- | --- |
| `isWithinUnder` win32 and posix containment rules | `packages/market-catalog/src/scanning/paths.ts:139-142`, `packages/market-catalog/test/paths.test.ts:15-85` | mutation (always true) fails 9 cases |
| Archive symlink escape walk | `packages/market-catalog/src/scanning/archive.ts:350-375` | mutation fails `zip-bomb.test.ts` |
| Credential redaction: keys, URLs, error messages, `args` | `packages/market-contracts/src/redaction.ts`, `mcp-redaction.test.ts`, `server-config.test.ts:96-97` | mutating `redactArgs` fails 3 cases; URL and message redaction have exact expected strings |
| Frame escaping | `packages/market-runtime/src/runtime/surfaces/prompt-frame.ts:44-46` | mutation fails 3 cases in `prompt-frame.test.ts` plus `output-styles.test.ts` and `prompt-injection-conventions.test.ts` |
| Foreign MCP namespace guard | `packages/market-mcp/src/runtime/mcp/mcp-mounts.ts:352` | mutation fails `mcp-mounts.test.ts` |
| The deleted-`AGENTS.md` class | `packages/market-bundle/test/integration/instructions.test.ts:130-135` | `fixtureOnly` refuses any path outside `tmpdir`, and a case asserts it throws for `process.cwd()`; every route mounts through `mounted()` (`:149`) |
| Static subagent-member scan | `packages/market-bundle/test/repo/helpers/subagent-member-scan.ts` | 20 positive samples plus an explicit "records the shapes it does not resolve" case (`subagent-seam-ownership.test.ts:181`) |
| `causeMessages` redaction and cycle stop | `packages/market-runtime/test/failure-detail.test.ts` | exact expected strings, including a URL token and a self-referential chain |

## Checked and not findings

- **Real timers, 93 occurrences.** Most bound a wait inside a fake-timer suite or a genuine deadline. The only wall-clock bounds tight enough to flake are F6 and, more loosely, `mcp-toggle-latency.test.ts:84` (`passMs < baselineMs * 2`, a self-relative ratio) and `resource-filter-budget.test.ts:30` (`< SWITCH_SETTLE_MS + 800` against a pass held open forever, which hangs rather than passes if the budget breaks).
- **`process.cwd()`, two occurrences.** Both are the _subject_ of the case, not a fixture path: `instructions.test.ts:194` asserts the guard rejects it, and `extension-session-recovery.test.ts:421` creates an agent whose workspace is the repository.
- **Temp directories.** Every `mkdtemp` root in the integration suite is registered and removed through `removeTempRoot` (`helpers/temp-root.ts`), including the paths added after that helper landed.
- **Snapshots nobody would review.** None: the suite has zero `toMatchSnapshot`, `toMatchInlineSnapshot`, and `toMatchFileSnapshot` calls.
- **`errors.length).toBeGreaterThan(0)`** at `discovery.test.ts:250` reads weak but is paired with `expect(config).toBeUndefined()` on the line above, so the case still fails if the rejection stops happening.
- **Helpers that are a second implementation.** `helpers/fake-oauth-mcp.ts` (432 lines) is a loopback OAuth server and `subagent-member-scan.ts` is a syntax-tree scan. Both are the shape the reliability skill endorses for their risk: each owns a real protocol or a real parse and each is driven by tests with negative samples, rather than re-stating the implementation under test.

## What could not be verified

- The three proven findings were confirmed on a copied tree with the suite run on macOS only. Their verdict is "no test fails", which is platform-independent by construction, but the Windows job was not run.
- The 45 ms bound (F6) is inferred to be flake-prone from its slack, not observed failing. Reproducing it needs a contended runner.
- Coverage percentages were not consulted: a line covered by an assertion that cannot fail is the same as a line not covered. That is why every verdict above rests on a mutation or on reading the assertion, not on a coverage number.

## Mutation log

| #   | File and line               | Mutation                                      | Result                    |
| --- | --------------------------- | --------------------------------------------- | ------------------------- |
| F1  | `validate.ts:173-176`       | containment check removed, `return undefined` | 2416/2416 passed          |
| F2  | `hooks-mounts.ts:71`        | fingerprint memo removed                      | 2416/2416 passed          |
| F3  | `mount-lifecycle.ts:99-103` | `clear()` made a no-op                        | 2416/2416 passed          |
| -   | `paths.ts:139-142`          | `isWithinUnder` always true                   | 9 failures                |
| -   | `archive.ts:350-375`        | symlink escape walk skipped                   | 1 failure (`zip-bomb`)    |
| -   | `prompt-frame.ts:44-46`     | `escapeFrameBody` returns the body            | 6 failures across 3 files |
| -   | `redaction.ts:90-107`       | `redactArgs` returns its input                | 3 failures                |
| -   | `mcp-mounts.ts:352`         | foreign guard never fires                     | 1 failure                 |
