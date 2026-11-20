# Agent Note: The extension preset chip reads the session projection

Status: implemented

## Problem

The preset chip in the composer rendered state words instead of a selection. It asked a route for its label, so it said `加载中…` while that request ran, and `扩展尚未就绪，先给这个会话发一条消息` / "Extensions are not ready yet. Send a message in this session first." whenever the session had no live Agent. A session whose selection could not be published showed a third word, `会话扩展尚未就绪`.

None of the host's own composer chips behave that way. The permission seat reads the session's `permissions` projection; the model seat reads the durable model-selection projection and submits through `session.selectModel`, which the host documents as resuming the session. Their values ride session projections, seeded by the history snapshot and advanced by projection frames, so those chips have an answer before any request and never show a wait.

Ours also asked the person to repair a state the control could reach itself: `sessionController.resolveAgent` is the seam the host uses for every agent-bound read and write, and the route only took a plain `ctx.agents.get`.

## Decision

The committed selection is a client-visible session projection. `extensionSelectionProjection` (`packages/market-runtime/src/runtime/host/extension-selection-projection.ts`) folds the last `market-extension-selection` message whose binding is `committed` — a pending request never moves the chip — and publishes `{ presetId, presetName, modified }` under `marketExtensionSelection` with `summary: true`. Both units register through `SessionProjectionReader` (`projection-reader.ts`), the shared lifecycle that already owned the progress unit.

The composer seat receives `useProjection` in its session standard kit, and the entry renders the chip from `useProjection(EXTENSION_SELECTION_PROJECTION_KEY)`: the preset name, or the global word when the fold names none. No loading word, no not-ready word, no instruction. Before the first answer the chip draws its icon only, so it claims nothing it does not know. A pending request still wins over the fold, because the panel's answered intent is newer.

A choice made in the menu is shown before the server acknowledges it. The commit mounts suites, hooks and services, so the acknowledged selection can take a second on a session that mounts MCP servers; waiting for it holds the old name on a control the person just clicked. `applyPreset` names the chosen preset immediately, the acknowledged window replaces it, and a failure drops back to the committed name. A second click replaces the pending one without the first settlement clearing it.

The window route keeps its job: the menu rows, the library, the inventory and every write. It now activates a persisted session through `ctx.get('sessionController').resolveAgent(sessionId)` before answering, shares one in-flight attempt, remembers a failure for ten seconds, and waits for an initialization already in flight instead of reporting it. A host without that seam keeps `extension-session-not-found`.

`epSessionInactive` and `epNotReady` are removed from both locales. A read failure renders `epLoadFailed` with its code, both on the chip and in the menu, because a failure is not a wait.

## Alternatives considered

- **Keep the route-only label and shorten the wait by polling faster.** Lost because it treats the symptom: the chip would still depend on a request, and still be the only composer chip that waits.
- **Render the library and the selection from the route, with no projection.** Lost because the label must exist before the request does; a cold session's first read is a resume, not a lookup, so the chip would show nothing until that finished.
- **Show a neutral loading word instead of a state word.** Lost because the host chips show the selection, not their own progress: with a projection there is no progress to show.

## Consequences

The chip is correct on the first render, for a session with no Agent, at rest, and mid-turn; it survives a route failure with the last committed name. The cost is a second publisher of the selection: the projection is display-only and never authorizes, but it duplicates the fold the state machine already performs, so the two must agree on what `committed` means.

A failed activation now surfaces as `session/writer-held` or another seam code instead of a wait state, and the menu names it. A host that composes no session runtime keeps `extension-session-not-found`, which the chip renders as a load failure rather than an instruction.

## Testing

`extension-selection-projection.test.ts` pins the fold (pending ignored, committed applied, unchanged reference for a repeated envelope) and the published value after a real `select`. `extension-window-activation.test.ts` pins activation, one shared attempt, the failure code and the retry window. The composer integration tests pin that the chip renders the projected name before any read answers, that a chosen preset is named before its write is acknowledged and reverts when the write fails, and that a load failure still offers Retry.
