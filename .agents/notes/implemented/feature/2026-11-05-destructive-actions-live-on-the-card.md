# Agent Note: the destructive action lives on the card, and a card action names its row

Status: implemented

## Problem

The market page could not uninstall a suite from its card any more, and every feature's uninstall had ended up in a different place inside the detail. A reader who had to open a card, hunt through the dialog and find the one irreversible button was reporting the loss of an affordance they had used every day: the destructive action used to be a hover-revealed flat icon on the card.

The one-renderer migration of 2026-10-30 produced that shape. Three surfaces gave up their own card implementations and, with them, their card actions. The rule behind it was [the card rows note](../bug-fix/2026-10-30-card-rows-and-the-switch-that-never-hides.md): the card's click means "open", so the one irreversible action waits one step inside.

The result was uneven rather than uniform. The market card was the last surface that still carried its uninstall, so the owner asked for it back; three surfaces that had never had a card action grew one inside the detail, in a different place each. The rule that produced the shape was written down in two places that had to change with it: the shared renderer's module doc and rule 4 of `AGENTS.local.md`.

A second defect sat in the same cluster and is the same defect: an icon button whose accessible name is the bare verb announces the same thing on every card of the list. The switch and the edit button already answer it — the switch's label is the verb and the row's name, the edit button's accessible name is `panelEdit` and the row's name, and both carry the bare verb as their tooltip — but the destructive action had no name at all, because it had no place on the card.

## Decision

- **The card is the entry point to the action; the panel's confirmation still owns the delete.** Every surface that owns a destructive action now puts one flat danger icon button on that entry's card: `IconTrashOutlineMedium`, `danger: true`, which the shared renderer paints as `card.iconBtnDanger` under `card.revealOnHover`. Clicking it opens the surface's existing confirmation, the shared `ConfirmModal`, and removes nothing by itself. The detail dialog the card opens keeps the button it already had, so the action never loses a path.

- **A card action's accessible name is the verb and the row; its tooltip is the bare verb.** This is now the convention for every card action in the product, not only the destructive one:
  - the accessible name is the verb and the row it acts on — "卸载 <suite>", "删除连接器 <connector>", "删除 <entry>", "删除输出风格 <style>", "删除文件 <path>";
  - the tooltip is the bare verb, because the tooltip answers "what does this do" and the row is already on screen;
  - the renderer carries the two shapes separately: `ResourceCardAction` gained an optional `title`, and the button renders `aria-label = action.label` and `title = action.title ?? action.label`.

  This is the shape the repository already settled twice in the same renderer: [the card controls note](../bug-fix/2026-10-30-card-controls-answer-their-own-keys.md) ("a switch names its verb and its row", where "971 indistinguishable switches" was the defect), the switch's own `toggleLabel + ' ' + entry.name` with a bare title, and the edit button's `panelEdit + ' ' + entry.name` with a bare title. The pre-refactor MCP card did the same: `title = t('mcpDelete')`, `aria-label = t('mcpDelete') + ' ' + displayName`.

  The market suite card took the same shape: its uninstall is `t('uninstall') + ' ' + suite.name` with a bare `t('uninstall')` tooltip, and its refresh action, which had been announcing a bare "刷新" on every card, now names the suite it refreshes.

  Two bare-verb keys did not exist and were added to both locale blocks: `outputStylesDelete` ('删除输出风格' / 'Delete output style') and `instructionsDelete` ('删除文件' / 'Delete file'). The MCP connector, the user panel and the market card already had their verb.

- **Which rows may be deleted did not change.** Each surface reuses the predicate its own detail already used, and neither widens nor narrows it:
  - MCP connectors: `deletable()` in `features/mcp/StatusPanel.tsx` — a user-owned direct declaration (`kind === 'direct'` with a suite id and a server key). A suite declares its servers in its own `mcp.json`, so a suite row is the source's to remove, not this panel's.
  - User panels (skills, commands, personas): `entry.origin === 'user'`. A suite-owned file uninstalls with its suite.
  - Output styles: `row.source === 'user'`. A suite's style and the workspace's style are not the reader's to remove.
  - Instructions: every listed file, which is every file that exists in the chain.
  - Market suite cards: only an installed suite carries the uninstall, which is the predicate the entry mapping already used. An uninstalled suite keeps the card's primary install button and no trash.

- **The renderer needed no rework beyond the name.** `ui/ResourceSurface.tsx` already rendered every `entry.actions` item as a flat icon button, with the danger hover for `action.danger === true`; it only needed the optional `title` to carry the two name shapes. The module doc changed too: it had said that destructive actions belong to the detail the card opens, and it now says the opposite. `primary` is still never destructive: the one visible button on a card stays a text button.

- **The standing rule changed with the code.** Rule 4 of `AGENTS.local.md` now reads 破坏性操作上卡: the destructive action is a hover-revealed flat danger icon on the card, it opens the panel's existing confirmation, there is no one-click delete, the detail keeps its own button, and the panel's own rule decides which rows qualify.

## Alternatives considered

- **Keep the rule and give the market card back only its uninstall.** Rejected: the owner named the loss on every surface, not on one, and two rules for one card anatomy is how the drift started in the first place.
- **Let the card delete in one click.** Rejected: the confirmation is the only thing between a hover-reachable trash icon and an irreversible removal. Every surface already had a confirmation flow, and the change reuses it rather than replacing it.
- **Widen what may be deleted so every card carries the icon.** Rejected: the deletability rule is a trust boundary, not a display choice. A suite's file belongs to the suite, and the card's icon would have been a button that fails when it is pressed.
- **Remove the detail's button so the action has one home.** Rejected: the detail is where the facts about the file are. A reader who opened an entry to read what it is should not have to go back to the list to remove it.
- **Add a new renderer affordance for destructive actions.** Rejected: `entry.actions` with `danger: true` already is that affordance. A second mechanism would be a second spelling of one thing.
- **Name the button with a bare verb.** Rejected: in a list of thirty connectors, thirty buttons that all read "删除" say nothing about which row each one destroys. The accessible name carries the row; the tooltip stays bare.
- **Use the dialog's title sentence as the accessible name.** Rejected: "删除 MCP 服务「x」" is a sentence for a dialog, not the name of a control, and the repository's shape is verb plus row.

## Consequences

- A reader can now remove an entry from the list: hover the card, press the trash icon, confirm.
- The danger icon fades in on hover in the grid and is always visible in the list view, so a row that cannot be hovered still shows its action.
- A screen reader hears the verb and the row's name in the button ("删除 reviewer"), so a list of ninety-seven buttons is ninety-seven distinguishable buttons.
- Each surface's confirmation text, its error handling and its re-read are unchanged: the card's icon only opens the same dialog the detail opened.
- A card carries one more control, so the action cluster is one button wider. The switch still reads last and still never hides.
- Two bare-verb locale keys were added (`outputStylesDelete`, `instructionsDelete`); the dialog-title keys (`mcpDeleteTitle`, `panelDeleteTitle`, `outputStylesDeleteTitle`, `instructionsDeleteTitle`) stay in place for the confirmation dialogs.

## What this note supersedes

The three one-renderer notes are kept as they are; this note supersedes one clause of each, and only that clause:

- [The MCP list note](../simplification/2026-10-30-mcp-list-renders-through-the-one-renderer.md) decided that "**Deleting moves into the detail dialog.** The card's click means 'open', the one irreversible action waits one step inside it, and the panel's existing confirmation still owns the confirm-and-re-read flow." The middle clause is superseded: the one irreversible action is back on the card. The last clause stands: the panel's existing confirmation still owns the confirm-and-re-read flow.
- [The user panels note](../simplification/2026-10-30-user-panels-render-through-the-one-renderer.md) took as its premise that the surfaces "keep destructive actions inside the detail", and moved the delete action off the card for that reason. That premise is superseded: the delete action is back on the card, and the panel's confirmation still gates it.
- [The market page note](../simplification/2026-10-30-market-page-renders-through-the-one-renderer.md) rejected "**Leave uninstall on the card behind a confirm**", because the renderer's contract and the three migrated surfaces kept destructive actions one step inside the detail. That rejection is superseded: leaving uninstall on the card behind the confirm is now the decision, on all five surfaces.

[The market card affordances note](2026-09-02-market-card-platform-affordances.md) already put a flat uninstall icon on the suite card; this note extends that shape to the surfaces that lost it and settles the naming convention the cluster had left open.

## Verification

- `packages/market-ui/test/mcp-status-render.test.ts` proves the card of a user-owned connector carries the danger icon named "mcpDelete <connector>", that the click opens the shared confirmation without removing anything, that the confirmation removes the declaration and re-reads, and that a suite-declared server carries no icon at all.
- `packages/market-ui/test/user-panel-surface.test.ts` proves a user-authored entry's card carries the delete named "panelDelete <entry>" and a suite entry's card does not, that the click opens the confirmation without removing anything, and that the detail dialog keeps its own button for a user entry and still has none for a suite entry.
- `packages/market-ui/test/client-instructions-panel.test.ts` proves an instruction card carries the delete named "instructionsDelete <path>", that the click opens the shared confirmation, and that the dialog's own path still works and still reports the aliases a deletion leaves behind.
- `packages/market-ui/test/client-output-styles-panel.test.ts` proves a user style's card carries the delete named "outputStylesDelete <style>", that a suite style's card does not, and that the confirmation still removes the style.
- `packages/market-ui/test/resource-surface-parity.test.ts` proves the card skeleton is still the same on both surfaces, now with the action cluster as one of its rows.
- `packages/market-ui/test/market-section-render.test.ts` proves the market half of the same decision: the suite card's uninstall names its suite, the tooltip is the bare verb, the danger class is on, the first click opens the risk acknowledgement and calls no API, and the confirmed click posts the uninstall.
- `pnpm run typecheck` and `pnpm run lint` are clean for the touched files; the whole `packages/market-ui` suite is green; `check:css`, `check:single-renderer`, `check:reuse` and `check:doc-links` pass.
