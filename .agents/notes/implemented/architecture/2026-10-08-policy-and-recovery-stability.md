# Agent Note: Serialize policy state and recover queued user work

Status: implemented

## Decision

ResourceFilterService owns one workspace policy snapshot. The legacy surface facade delegates to that owner. Mutation and reload share a queue, and committed state is published only after persistence succeeds.

The existing host file lock serializes read-modify-write across processes. Individual updates merge with the latest document. Preset/reset operations intentionally replace both sections once. Global favorites use a separate locked document and capture input before awaiting.

Explicit session recovery restores validated durable choices. A capture that failed before recording a choice can retry with its original classification. Successful recovery or busy-attach retry resumes pending messages with the neutral user source only. Loading the plugin does not automatically start restored input.

Recovery markers remain outside model input. Foreign context, including context without a form, does not start work. The historical started field uses its existing broader definition because it reports progress rather than authorizing a new model request.

The host projection registry maintains that progress field incrementally. The reader owns registration and its injected fiber. An absent registry uses the historical scan fallback. Disposal and late registry arrival cannot revive registration.

Runtime teardown attempts every owner and waits for all results. Failures remain rejected for callers that await disposal; the detached product caller logs them. One failure cannot skip another owner.

## Alternatives considered

Separate service snapshots caused observed lost updates. Sharing the file without a shared owner was insufficient. A process-local queue alone also does not protect competing file writers.

A new lock implementation is unnecessary because the published atomic-write package already provides bounded writer coordination. Its lock is held only for file operations, not runtime refresh.

Waking every context message caused an unwanted model request. A positive neutral-user test is narrower and preserves explicit user work without treating absent form as authorship.

A custom event cache duplicates host projection ownership. The published registry already provides replay, incremental folds and unregister semantics.

Swallowing teardown failures would misreport success. Aggregate failures instead after every owner settles, and observe detached rejections at the composition root.

## Consequences

Stored workspace paths and v1/v2 read compatibility remain. New workspace writes use the existing v2 shape. Global favorites retain their v1 shape. No workspace file is written inside the project.

Runtime refresh remains serialized after a committed policy mutation. Slow refresh creates bounded back-pressure through the existing stage deadlines. Independent process snapshots converge on reload, not through a new watcher.

[The review ledger](../../../../docs/reference/refactor-review-ledger.md) records reproductions, corrections, tests and artifact acceptance. [The completion contract](../../../../docs/developer/design/refactor-completion.md) defines the final scope.

## Related

This partially supersedes the state ownership in [workspace toggles](../feature/2026-10-03-per-workspace-surface-toggles.md). Its hashed global location remains. The [transaction metadata decision](2026-10-06-extension-state-model-noise.md) retains durable envelopes and now also excludes wake markers. Neither decision is fully superseded. [Next-turn selection](2026-10-08-shared-surfaces-and-next-turn-selection.md) adds durable requests without replacing failed-transaction recovery.
