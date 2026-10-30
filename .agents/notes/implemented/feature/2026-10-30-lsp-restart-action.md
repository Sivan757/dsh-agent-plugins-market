# Agent Note: A language server is rebuilt by an explicit restart, because the seam reports no death

Status: implemented

## Problem

A mounted language server is a registration, not a process. `ctx.lsp` exposes provider registration and query routing and nothing else: no provider snapshot, no process probe, and no event. `dsh-lsp-stdio` learns that a server died only when the next query rejects, so the plugin holds a disposer and no way to observe the child it mounted.

That had two visible costs. A dead or wedged server kept rendering as mounted with no reason, which is the one state a user cannot act on. And recovery waited for whichever unrelated event re-ran a reconcile, so a user who fixed the cause, or who wanted the process replaced now, had no control to press.

## Decision

The LSP detail dialog offers **Restart server** for a mounted or a failed row. It calls one new route with that row's id, which flags only that mount and re-runs the reconcile pass; an id-less call flags every live mount, for a caller that cannot name one service.

- `LspMountRegistry.forcedRemounts`, `forceRemount(key)` and `forceRemountAll()` mirror the MCP registry, and the reconcile loop treats a forced key as fingerprint-mismatched: the live provider is disposed and a fresh one mounts with the same resolved config. A flag survives a failed teardown so the next pass retries it, and is dropped when the key has no live mount, which the ordinary mount path already covers.
- `LspService.restart()` flags, calls `notifyChanged(true)` and waits on the bounded `refreshSettled()`, exactly as `McpService.retryMounts()` does. The request answers with the state the pass reached, never with a promise that a slow remount will finish inside the call.
- `CatalogPorts.lspRestart` takes an optional id and defaults to a no-op, `MarketMutations.restartLspServers(id?)` carries it to the HTTP layer, `MARKET_ROUTES.lspRestart` is the POST, and `restartLspServers(id?)` in `api.ts` is the client call. The row id is also the mount key, so the dialog names its own mount and one restart leaves the other language servers' in-flight work alone.
- The action is offered on `mounted` and `failed` rows only. A conflict, a missing package, or a disabled row needs a different repair, and offering a rebuild there would teach the user that the button does nothing.
- The workspace resource detail renders the same dialog without the action, matching the MCP read-only variant there.

A forced rebuild kills the process, so the next request pays a cold start. That is the trade: the seam cannot pre-warm a server, because the host spawns one process per canonical workspace on the first matching query and a mount pass has no workspace to offer. Replacing a wedged provider is worth one cold start when the alternative is waiting for a timer.

## Alternatives considered

- **Poll the process from the plugin.** Rejected: `ctx.lsp` publishes no provider list and `dsh-subprocess` emits no lifecycle event, so the only probe available would be a synthetic query, which spawns a server, reads a real source file, and names a workspace the panel does not know.
- **Wrap the `lsp` tool to record query outcomes.** Not rejected forever: it would put a real reason on the row, but it depends on wrapper ordering against the host timeout policy and changes nothing about recovery. It stays the next step from the stability audit.
- **Shorten the failure path with a lower tool-call timeout.** Rejected: the host tears a still-initializing instance down when its call budget expires, so a lower budget turns a slow server into one that can never start.
- **Reuse the enable switch as the restart.** Rejected: it rewrites the stored disabled list, so a user would toggle a server off and on to recover it, and a server whose surface is switched off cannot be reached that way at all.
- **Remove and re-add the declaration.** Rejected: it edits a source-owned file to recover a runtime state, and a suite declaration is not the user's to rewrite.

## Consequences

- A user can replace a language-server process without waiting for a retry timer or restarting DSH, and without disturbing the other mounted servers.
- Restarting a healthy server is allowed and costs one cold start on the next request. The action is labeled, not guarded, because checking health first would need the probe this seam does not have.
- An in-flight query on the rebuilt server fails with `LSP_DISPOSED`, and the row then reports the new mount.
- A failed remount produces a fresh mount diagnostic, so the row finally carries a reason in that case.

## Verification

- `packages/market-bundle/test/integration/lsp-mounts.test.ts` proves a named restart rebuilds only that mount, a whole-workspace pass disposes every live provider and mounts fresh ones with the same config, that a restart issued mid-pass is queued rather than overlapped, and that a flag on a key with no live mount changes nothing.
- `packages/market-bundle/test/integration/routes.test.ts` proves the POST reaches `restartLspServers`.
- `packages/market-bundle/test/integration/client-lsp-detail.test.ts` proves the action renders on a mounted and a failed row, echoes the outcome, is withheld for a conflict or a missing package, and stays hidden on the read-only surface.
- Typecheck, lint, the CSS class gate and the doc link gate are clean for the touched tree.

## Related decisions

[Self-provisioned LSP capability](../architecture/2026-09-11-self-provisioned-lsp-capability.md) owns the mount lifecycle this action rebuilds, including why a mount failure stays a diagnostic rather than entering a retry.
