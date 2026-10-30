# Agent Note: the last lsp call is the only evidence a language server is dead

Status: implemented

## Problem

`ctx.lsp` publishes no provider snapshot and no process event, and `dsh-lsp-stdio` learns that a server died only when the next query rejects. A provider that exited therefore keeps its mount, keeps matching its own configuration, and keeps rendering as mounted with no reason — the exact state a user cannot act on. The status audit ranked this first: recovery exists now (the restart action), but the row still cannot say why anyone would press it.

## Decision

- **One observation point, and it is the tool call.** `RuntimeReconciler` listens on `tools/post-execute`; a pure helper (`runtime/core/lsp-call-observation.ts`) answers whether the call was the host's `lsp` tool and what it did, and the listener records that against the provider. Nothing is estimated: a provider that is never asked leaves no evidence, which is honest about what the seam knows.
- **Attribution is by file extension.** The seam routes one request to the provider claiming that extension and rejects a duplicate claim at mount time, so a path names at most one live provider. A path no live provider claims records nothing rather than guessing.
- **The registry owns the evidence, and forgets it with the mount.** `LspMountRegistry.observe` stores the latest outcome per provider id, `observationSnapshot` publishes it to the status builder, and unmounting a provider drops its record: a restarted process must not inherit the old one's failure.
- **The row carries the observation beside the state, not instead of it.** A mounted row with a failed call shows a "last call failed" warning and the detail names the error and offers the restart. The state stays mounted, because the mount is alive and one failed call can mean a missing file or a timeout as easily as a dead process.

## Alternatives considered

- **Mark the row failed when a call fails.** Rejected: a single failure cannot tell a dead process from a bad path, and a false "failed" on a healthy server is worse than an accurate observation beside a mounted state.
- **Wrap `tools/execute` instead of observing post-execute.** Rejected: pre-execute denials, cancellations and timeouts never ran the tool, so they are not provider evidence; post-execute is where a completed call exists.
- **Probe the process on a timer.** Rejected: the seam has no probe, and a synthetic query would spawn a server and read a real file to answer a question the next real request answers for free.
- **Keep a history of calls.** Rejected for now: the panel needs the verdict, not a log; a history would grow without a reader.

## Consequences

- Only calls the host's `lsp` tool makes are observed; a language server used through another client leaves no row evidence.
- The panel shows the latest call, not a trend, so a recovered server clears its warning on the next successful call.
- The observation is additive to the status wire shape: a consumer that ignores it reads exactly what it read before.

## Verification

- `packages/market-runtime/test/lsp-call-observation.test.ts` pins the extraction: a successful call, a failure carrying its message, and every non-attributable shape (another tool, no path, an empty path).
- `packages/market-bundle/test/integration/lsp-mounts.test.ts` pins attribution and forgetting: the extension owner receives the record, an unclaimed extension records nothing, and disposing the mount clears it.
- `packages/market-bundle/test/integration/lsp-status.test.ts` pins the row: the observation rides the row while the state stays the mount's own judgment.
- `packages/market-bundle/test/integration/client-lsp-detail.test.ts` pins the dialog: the last call and its error render, with the restart action one click away.
