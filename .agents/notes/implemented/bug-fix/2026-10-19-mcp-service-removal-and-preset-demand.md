# Agent Note: Removing a declared MCP service and reporting preset demand

Status: implemented Date: 2026-10-19

## Problem

The MCP surface had one write path and no way back. A user could add a service through `mcp-servers/add`, and the JSON view of that same editor could not even complete the add: while creating a service the editor kept a draft key, and the document reader refused a pasted keyed document because its `mcpServers` key differed from the draft. The name field then locked, the save stayed disabled, and no delete action existed anywhere to remove the service that had been configured. A service switched off in a workspace whose preset selected it also reported the red `orphaned` state, which describes a failed teardown rather than the switch being outranked by demand.

## Decision

Three changes ship together because they are one story about a user-owned service's lifetime.

- **Creation reads the document it was given.** `readDraftServerDocument` in `packages/market-ui/src/ui/server-form.ts` accepts a bare server object (read under the draft name key) and a keyed document (adopting that document's single `mcpServers` key and its `com.deepseek.harness` policy half). The key the document names becomes the name shown in the field, so the name and the declaration never disagree. Edit mode keeps the strict `parseServerDocument` reader, because a renamed seat would silently point the save at a different service.
- **A user declaration can be removed.** `POST /api/agent-plugins/mcp-servers/remove` takes `{ suiteId, serverKey }` and reaches `McpService.removeServer` (`packages/market-mcp/src/application/mcp-service.ts`). Only the `@user-mcp` declaration is removable; a suite-declared server is refused with a message that names disabling as the supported operation. The removal writes the declaration first, keeps every top-level key it does not model, re-validates the remaining document before writing, then drops the server's override record and its OAuth grant, and joins the reconcile settle pass so the bridge is gone before the response returns. The action sits in the card's action row, behind a confirmation, and only for a `direct` row; the detail dialog reports the service and offers recovery, so a destructive button does not sit beside the read-only facts it describes.
- **Session demand is reported as demand.** The mount pass merges a session's selection into the mount request as `enabled: true`, so a server the user switched off stays live while a preset selects it. `RuntimeReconciler.demandedMcpMounts()` publishes that set through the optional `mcpDemandedMounts` catalog port into `buildMcpStatus`, which now reports state `disabled` with code `preset-demand` and a reason naming the preset instead of `orphaned`/`orphaned-tools`. A mount diagnostic still wins, so a genuine failure under the demand is never explained away. The demand-wins ordering itself is unchanged.

## Alternatives considered

- **Allow deleting any declared server.** Rejected: a suite's `mcp.json` is source-owned, so a refresh or reinstall would restore the server and the delete would read as broken. Disabling is the operation that survives a refresh.
- **Rewrite `mcp.json` from the parsed suite.** Rejected: the parsed shape drops top-level keys this client does not model and would rewrite the other declarations. A removal must change exactly one key, so the raw document is re-read and one key deleted.
- **Strip the demand merge so the panel switch wins.** Rejected for this change: demand-wins is deliberate and shared with LSP, and reversing it would make a preset fail its own activation check. The defect was the reported state, not the ordering.
- **Report the orphaned state but hide the switch.** Rejected: it removes the user's ability to see what the preset did, and the sentence is what tells them to change the preset instead.
- **Give the remove route its own path without the port.** Rejected: the routes call the catalog's `MarketService` facade, so the port member keeps the wire and the use case in one contract.

## Consequences

- A user-owned service can be created, edited, switched, and deleted, and the JSON add flow adopts the pasted key instead of blocking on it.
- A removal drops the override record and the OAuth grant, so a later service of the same name starts clean.
- A preset-selected server reads as disabled with an explanation instead of red, and calling it still fails through the tool gates: availability is unchanged.
- The demanded set is read per call; a composition without a session layer answers an empty list and every status row reads exactly as before.
- A project-dimension MCP row is not covered: its demand arrives through the scoped contributor layer and `createProjectExtensionResources` builds its status without the demanded list, so such a row can still report `orphaned`. Extending it needs the project demand set published to that reader.
- Removing a declaration is not a cross-file transaction: an interrupted removal can leave an inert override record, never a live service whose policy was silently dropped.

## Testing

`packages/market-bundle/test/integration/mcp-remove.test.ts` covers the happy path, the refusal for a suite-owned server, and the empty-table case. `packages/market-bundle/test/integration/mcp-status.test.ts` covers demanded, no-demand, and diagnostic-wins rows. `packages/market-ui/test/client-detail-editors.test.ts` covers the document adoption and the edit-mode refusal, and `mcp-status-render.test.ts` covers the delete action on both surfaces. `packages/market-runtime/test/demand-outranks-mcp-toggle.test.ts` pins the ordering the status fix depends on.

## Related decisions

[The MCP services surface](../feature/2026-09-02-market-card-platform-affordances.md) sets the card anatomy this action sits in.
