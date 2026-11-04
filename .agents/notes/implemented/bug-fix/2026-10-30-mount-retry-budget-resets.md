# Agent Note: a mount that came back forgets its retry budget

Status: implemented

## Problem

The shared `RetryScheduler` caps attempts at five per mount key and never reset the count when the mount later succeeded. Its docblock claimed the count resets with every reconcile pass, but nothing did. A suite server or language server that failed five times over its life — across unrelated outages, weeks apart — could never be retried again: the sixth failure logged "giving up" and armed no timer. The panel had no action that cleared the budget either, so a server that worked yesterday could stay unmounted until the Host restarted. This is one of the shapes behind "reconnecting takes forever and then stops helping".

## Decision

- **`RetryScheduler.settle(key)`** cancels the key's pending timer and drops its attempt count.
- **Both registries settle on success.** The MCP pass settles a key whose live config fingerprint still matches and a mount that returns no failure; the LSP pass settles both of its live paths. A mount that is live is by definition not crash-looping, which is the only thing the cap protects against.
- **Deterministic skips keep their rule.** A target scheduled without a reason still drops its budget rather than arming a timer; nothing about that changes.

## Alternatives considered

- **Raising `MAX_RETRY_ATTEMPTS`.** Rejected: it defers the same defect by a few attempts and keeps the budget permanently spent afterwards.
- **Clearing every budget on every reconcile pass.** Rejected: a crash-looping server would be retried forever, which is the behavior the cap exists to prevent.
- **Resetting on any successful pass rather than per key.** Rejected: one healthy sibling would hand a broken server an endless supply of attempts.

## Consequences

- A server that mounts and later fails starts again from 1.5s, and its retries go 1.5s / 5s / 15s / 45s / 120s across that outage.
- The budget now means consecutive failures, which is what the cap was always describing.

## Verification

- `packages/market-runtime/test/retry-scheduler.test.ts` pins all three behaviors: five failures exhaust the budget and a sixth stays silent, `settle` re-arms the next failure at the first delay, and `settle` cancels a pending timer.
- Typecheck clean; the MCP and LSP mount suites pass.
