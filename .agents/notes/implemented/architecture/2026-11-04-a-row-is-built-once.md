# Agent Note: a row is built once, by the surface that shows it

Status: implemented

## Problem

A row appears twice: on its own settings face, where it belongs to the workspace, and inside the preset manager, where it belongs to a preset. Both draw the same card and answer the same questions, and both used to answer them in their own code. The failure sentence existed twice, the switch verb existed twice, and the tool-count and transport slots were filled twice. The predictable result was drift: a fact added to a panel appeared in the manager only if someone remembered it, and the tests could only catch the copies they already knew about.

## Decision

- **One builder, `client/ui/face-entry.ts`.** A surface adapts its row type to `FaceRowFacts` and names its mode; the builder returns the entry the shared card renders. The rail, the state word, the switch's existence and verb, the counts, the meta line and the failure sentence are computed there.
- **The modes differ in exactly two ways.** The settings face names what the row is doing (`已连接`, `失败`), and a preset names whether the row is in it (`已启用`, `已停用`). And a preset distinguishes two refusals — a host-managed row versus a row with nothing behind it — because it holds rows the host cannot switch at all.
- **The failure sentence is composed once.** `liveFailureSentence` is the single place that runs the guidance classifier, keeps the advice, and appends the attempt time; both surfaces read its answer, so a slow failure reads the same on a card and in the manager.
- **The manager and the two service faces migrated first.** They are where both surfaces exist and the facts are richest. The authoring faces keep their own entry mapping for now: their cards carry edit and delete, which this builder deliberately does not own, and they already share the facet table and the sentence.

## Alternatives considered

- **Share the panel components instead of the entry.** Rejected: a settings panel owns a live supervisor, retry handlers, dialogs and an editor; none of that belongs in the manager, and moving it would trade a small duplication for a large one.
- **Unify the state words too.** Rejected after reading both surfaces: `已连接` answers "is it running" and `已启用` answers "is it in my preset". One word for both would answer neither question on the page that asks it.
- **Derive the entry on the server.** Rejected: the card is a rendering decision, and the server already ships the facts (`runtime`, `transport`, `toolCount`); a second entry shape over the wire would duplicate the contract instead of the logic.

## Consequences

- A fact added to `FaceRowFacts` reaches both surfaces at once, and a missing one is a type error in the builder rather than a silently absent line on one card.
- The preset manager no longer carries its own warning composition; `runtimeWarning` is gone.
- The remaining faces (market, skills, commands, experts, output styles, instructions, hooks) still build their entries in place. Moving them is mechanical and now has a target shape.

## Verification

- Live, the same rows on both surfaces: `cloudflare` reads `套件 · https://mcp.cloudflare.com/mcp · 工具 4 · streamable-http` in settings and `套件 · https://mcp.cloudflare.com/mcp · 工具 4 · streamable-http` in the manager; `kuboard` (failed) reads `连接超时 · 10.0s` on both, from one composition. Only the state word differs, by design.
- `face-entry.test.ts` (5 tests) pins the parity: one failure sentence, identical facts, the two deliberate differences, no switch where a surface has none, and no invented failure for a row that is merely switched off.
- `market`, `hooks`, the authored panels and the output styles were migrated onto the same builder with every existing card assertion passing unchanged, which is what proves the copy and the actions survived the move.

- Full suite: 2,556 tests pass; gate clean.
