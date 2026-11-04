# Agent Note: the section rail names its page, not one of its tabs

Status: implemented

## Problem

The settings rail was labelled with the market tab's own name: `PluginWorkspace` passed `label: labelKeys.market` to `TabRail`, and the rail uses that string for both its `aria-label` and the prefix of its two step buttons. A reader on 连接器 heard the tab list announce "市场", and its step buttons read "市场 · 向后一个" no matter which section was open. The same wrong subject reached every surface, because the rail is the shared one.

## Decision

- **The rail names the settings page.** `label: t('nav')` — "Agent 扩展", the name the settings navigation already gives this page. The step buttons inherit it and now read "Agent 扩展 · 向后一个".
- **The test that pinned the old name moves with it.** `client-workspace-tabs.test.ts` asserted the tablist was called `workspaceTabMarket`; it now asserts the page name and says why.

## Alternatives considered

- **Name the rail after the active tab.** Rejected: a tab list named after its selected tab says the same thing twice and changes as the reader moves.
- **Give the rail a new key.** Rejected: the page already has one, and two names for one page drift.

## Consequences

- A screen reader hears "Agent 扩展, tab list", then the tabs, then "Agent 扩展 · 向后一个" for the scroll control.
- Any surface that adds a section to this page inherits a correct rail name.

## Verification

- `packages/market-ui/test/client-workspace-tabs.test.ts` asserts the rail's accessible name is the page's.
- Measured in `market-dev`: `tablistLabel: "Agent 扩展"`, step button `"Agent 扩展 · 向后一个"` (was 市场 in both).
