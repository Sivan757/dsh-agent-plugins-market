# Refactor review ledger

## Scope and evidence

This ledger closes the [completion contract](../developer/design/refactor-completion.md) from checkpoint 92936ff. Source inspection, executed tests and live acceptance are separate evidence. No finding closes through a file move alone.

## Workspace policy consistency

Status: closed. Priority: high.

At baseline, surface and entry services retained independent copies of one document. Entry updates restored stale surface values. Competing services lost independent updates. Failed persistence changed memory. Three initial regressions failed.

ResourceFilterService now owns the live snapshot and SurfaceToggleService delegates. Mutations read current disk state under the host file lock and publish only after persistence. Reload shares mutation ordering. Preset/reset writes both sections once.

Complete replacement intentionally uses last-writer-wins semantics. Individual updates merge. Separate processes converge on reload; no watcher is introduced. Runtime refresh remains serialized after commit and can delay a later update.

Evidence: [initial failures](refactor-final-2026-10-08-evidence/policy-red.txt), [nine contract cases](../../tests/workspace-policy-consistency.test.ts), [canonical writer](../../packages/market-runtime/src/application/state/workspace-policy.ts), and [six independent writers](refactor-final-2026-10-08-evidence/packed-acceptance.txt#L7-L8).

## Global favorite concurrency

Status: closed. Priority: high.

Four initial failures demonstrated save/save loss, save/delete loss and mutation of caller-owned input before persistence. Favorite operations now snapshot input and lock the entire read-modify-write. The global document remains separate from workspace policy. Paths and the version-one shape remain unchanged.

Evidence: [five concurrency cases](../../tests/resource-favorites-concurrency.test.ts), [locked writer](../../packages/market-runtime/src/application/state/resource-favorites.ts), and [six independent processes](refactor-final-2026-10-08-evidence/packed-acceptance.txt#L8).

## Recovery progress

Status: closed. Priority: high.

Confirmed defects included stranded input after successful recovery and no retry target after an initial capture failed before recording a selection. Follow-up tests found incorrect retry classification after queued input made the log nonempty.

Explicit recovery now retries only a capture that actually ran without recording a choice. It retains that attempt’s classification. Durable and corrupt records keep their existing validation rules. Busy attachment uses its own retry, not a falsely advertised manual capture retry.

Recovery wakes pending neutral user requests only after readiness. It uses the durable inbox, so process reload does not lose the wake decision. Empty queues, foreign context with or without a form, and failed busy retries do not create model requests. Ordinary plugin loading does not automatically run restored input.

Review found an unready wake and a false recoverable state during implementation. Added regressions reproduce both. The final implementation closes them rather than suppressing their failures. Per-agent recovery bookkeeping clears on disposal.

Evidence: [session state cases](../../tests/extension-session-state.test.ts), [recovery cases](../../tests/extension-session-recovery.test.ts), [implementation](../../packages/market-runtime/src/runtime/host/extension-session-state.ts), and [real failed-capture recovery](refactor-final-2026-10-08-evidence/packed-acceptance.txt#L9-L14).

## Shutdown and stale background work

Status: suspected remount disproved; teardown reporting repaired.

Downstream guards refuted the proposed post-disposal remount. Retry timers clear, disposed reconcile passes return, shared queues drain, and scoped teardown follows pending work. A missing await alone did not establish a leak.

A separate confirmed issue remained: a rejecting adapter could reject the detached product disposal promise without a handler. Teardown now attempts every owner, waits for all outcomes and reports aggregate failure. The detached caller logs rejection; callers that await still receive failure.

The [held-LSP/rejected-MCP regression](../../tests/runtime-disposal-reporting.test.ts) proves that disposal does not settle early or skip another owner. The [coordinator](../../packages/market-runtime/src/runtime/core/reconciler.ts) retains disposed admission guards. This does not promise forced termination of every non-cooperating external process.

## Repeated reads and projection lifetime

Status: closed within measured scope.

A scan of 50,000 synthetic non-matching events cost 1.285 ms p50 per window read on one machine. A host projection now folds once and advances per event. Missing-registry hosts retain the original scan as an explicit fallback. The wire field and polling interval stay unchanged.

The measurement covers the scan only, not inventory fan-out or typical end-to-end UI latency. No overall speedup percentage is claimed. The [measurement record](refactor-final-2026-10-08-evidence/progress-measurement.txt) states the synthetic input and sampling limits.

Review found that a late registry could re-register after reader disposal. The reader now owns the injected fiber, guards disposal and protects registration identity during service replacement. [Fourteen tests](../../tests/extension-window-progress.test.ts) cover semantics, repeated reads, replay, fork, missing service and registration lifecycle.

## Legacy simplification

Status: closed within compatibility constraints.

Unused non-refreshing applyAll/applySurfaces methods and the constructor overload that created another policy owner are removed. This also removes the special refresh-disabled mutation path.

Legacy storage readers, favorites and public routes remain because existing installations and one-time session migration still consume them. No removed user feature or destructive migration is hidden inside this cleanup. Broader legacy retirement is not required for the current completion contract.

## Final evidence and limits

The [quality gate](refactor-final-2026-10-08-evidence/gates.txt) passes. The [full suite](refactor-final-2026-10-08-evidence/tests.txt) passes 201 files and 1,908 tests. The [identity comparison](refactor-final-2026-10-08-evidence/test-comparison.json) retains all 1,868 previous tests and adds 40.

The [packed acceptance](refactor-final-2026-10-08-evidence/packed-acceptance.txt) runs the extracted public artifact in an isolated DSH profile. Six competing processes preserve six policy updates and six favorites. An actual capture failure recovers and completes the original request without another Send.

External dependencies reuse the existing installation. A fresh registry installation, current Windows execution and external-provider reliability are not established. Source-map and CodeMirror warnings remain in the passing test log. A malformed preset library must be repaired before recovery; the plugin does not erase corrupt user data.

No confirmed high-priority in-scope defect remains open. The implementation checkpoint is the commit that records this closure. No host source, live profile, remote push or publication changes.
