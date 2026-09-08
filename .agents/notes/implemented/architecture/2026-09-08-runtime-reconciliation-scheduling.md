# Agent Note: Runtime reconciliation scheduling

Status: implemented

## Problem

Startup, credential changes and settings updates can request overlapping runtime passes. A slow MCP connection previously delayed local command, hook and LSP registration, while unrelated download-region and feedback settings triggered extra mount passes. Disposal could race pending catalog discovery and recreate registrations after teardown.

## Decision

The host entry coalesces event bursts into one active reconciliation and at most one requested follow-up using a fresh catalog snapshot. Only a changed MCP backend setting triggers mount reconciliation. Teardown prevents new requests and ignores a discovery result that arrives after disposal.

The runtime reconciler executes independent surfaces concurrently while preserving ordering within each surface. Each surface waits for its in-flight work before disposal, skips queued work after teardown and contains its own failures. MCP connection latency therefore does not delay local registrations or their independent teardown.

This complements [selective runtime source discovery](../performance/2026-09-07-runtime-selective-discovery.md): source selection and scan-cache semantics remain unchanged. The active discovery-cache and runtime-surface notes do not define event scheduling, so this decision does not supersede them.

## Alternatives considered

**One global serialized queue** preserves order but makes independent local registrations wait for remote MCP readiness and replays every redundant event.

**Unordered concurrent passes** avoid the global wait but can register stale commands or hooks after a disable or teardown. Per-surface ordering preserves mutation semantics.

## Consequences

Slow MCP connections can still delay completion of the operation that requested them. Other runtime surfaces become available independently, and repeated settings or credential notifications cannot create an unbounded backlog of catalog passes. Credential notifications remain conservative so updates received before the first reference snapshot are not lost.

## Testing

`tests/plugin-apply.test.ts` verifies backend-event coalescing and suppression after disposal. `tests/runtime-reconciler.test.ts` holds MCP readiness pending while local surfaces complete, checks per-surface ordering, and verifies failure containment and disposal ordering.
