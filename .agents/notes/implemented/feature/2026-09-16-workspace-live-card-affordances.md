# Agent Note: live card affordances and the workspace query container

Status: implemented

## Problem

The workspace redesign was reviewed against its screenshots rather than against the prototype's own implementation, so everything a static image cannot show went unchecked: hover reveal, the action cluster's reserved width, transitions, the source strip's overlay layering, and reduced motion. Reviewing the prototype source turned up one defect that had been invisible the whole time:

1. **The narrow-container branch never applied on the market page.** Every responsive rule in the workspace is a `@container` query, and `panel.module.css .shell` is the only declared container. The plugin workspace's user-content surfaces compose that shell, but the market page renders its own root (`.market`), which declared no `container-type`. At the real 564px settings column the market therefore fell back to the base rules: one 552px card per row, fixed 122px rows, and the action cluster in its own grid column instead of hidden.
2. **Only the secondary icons hid.** The shared layer faded `.revealOnHover` children, so the enable switch and the primary install CTA stayed on screen while the icons beside them disappeared — a half-cluster, and not what the prototype draws.
3. **MCP and LSP cards had no actions at all.** The prototype gives both a card-level enable switch, and the backend already supported the operation in two places: `McpServerOverride.enabled` (MCP) and `setLspServerEnabled` (LSP), the latter with a route but no client caller.
4. **The card grid had drifted off the prototype's geometry.** A 260px track, a 10px gap, fixed 110px rows and a reserved two-line description were all compensations for the dead container query, and they hid the provenance in the grid view.
5. **The toolbar and the header diverged from the prototype.** Two view buttons instead of one toggle that reports the mode in force, no search glyph, and a text add button whose width tracks the language.

## Decision

- **The market page declares the container its rules already assumed.** `market.module.css .market` gains `container-type: inline-size`, so the settings column rather than the viewport decides the layout, on the market page as on the others.
- **Card geometry is the prototype's, expressed where it actually applies.** The base grid is `auto-fill minmax(280px, 1fr)` with 122px rows for a wide container; the narrow branch forces two `minmax(0, 1fr)` columns, a 4px gap, and content-sized rows. The description is capped at two lines without reserving them, so a one-line card is a shorter card and the grid row is as tall as its tallest tile.
- **The action cluster is one group and hides as one group.** In the narrow grid it leaves the flow, sits at the identity row's trailing edge, and the identity row reserves a fixed 88px (46px for the switch-only MCP and LSP cards) so the cluster's width never depends on the switch state. The whole cluster fades in on hover or `:focus-within` — switch and primary CTA included. Above the breakpoint only the secondary icons fade, which is the prototype's own two-tier rule.
- **The source row names its source in both views.** Provenance is no longer grid-hidden; it ellipsizes before the counts do, because the counts are what the row is scanned for.
- **MCP and LSP cards carry a real enable switch.** MCP routes through a new `set-mcp-server-enabled` route into `McpService.setServerEnabled`, which splits the source-qualified suite id and writes an `enabled` override — the suite's `mcp.json` stays source-owned, and a refresh cannot clobber the choice. LSP uses the `lsp-servers/enabled` route that already existed. Both panels also gain the `已禁用` filter (with the rows kept in the payload instead of filtered away), so a switched-off service is reachable and its count matches what clicking it shows.
- **A switch states enablement, not health.** An erroring or degraded row is still enabled: the rail and the state tag already report the failure, and turning the toggle off is exactly how a user stops a service that will not start.
- **The state tag replaces the state dot on MCP and LSP cards**, matching the other four surfaces and the prototype. The provenance tag next to it is a separate wrapper that the narrow grid hides, because the source row already names the suite.
- **One view button.** The toolbar's view control shows the mode in force with the pressed fill and names where a click leads, so the current mode is readable without hovering. The search field takes the host `Input`'s icon slot, and the header's add/refresh actions become the same flat 24px icon buttons the cards use, which stops the header width from tracking the language.
- **Ownership wording only.** Cards and the suite detail say `用户` / `插件`; the `用户级` / `项目级` strings are deleted rather than left unrendered.
- **The source strip's folded state clips and lifts.** `clip-path` bounds the strip's 6px overhang without clipping the hover overlay the way `overflow` would, and the folded strip takes `z-index: 20` on hover so its overlay paints above the cards.
- **Motion respects the preference.** The card's colour transition and the cluster fade are disabled under `prefers-reduced-motion: reduce`.

## Alternatives considered

- **Keep the 260px track and the 10px gap and skip the container.** Rejected: those values existed to work around the missing container, and they cost the grid its provenance line and its content-sized rows. Declaring the container fixes the cause and lets the prototype's numbers apply.
- **Make the whole workspace a single container in `ui/ResourceCard` instead of on `.market`.** Rejected: `ResourceCollection` is a descendant, not an ancestor, of the grid it styles; the container has to sit above the surface root, and the market's root is the only one not already composing `.shell`.
- **Hide only the icons and let the switch stay visible at every width.** Rejected: it reads as a half-cluster, and it is not what the prototype draws. The switch is an action like the others.
- **Have the MCP switch mirror `state === 'connected'`.** Rejected: that conflates enablement with connectivity, and it makes the control wrong in the one case it matters — a failing service could not be switched off, because flipping the switch would ask to enable an already-enabled server.
- **Reuse the existing `set-mcp-override` route from the client and split the qualified suite id in the browser.** Rejected: the qualified-id format is the server's, and duplicating its separator in the client is how the two drift. The new route mirrors `lsp-servers/enabled`, which already takes a composite id.
- **Drop the `已禁用` rows from the payload the way the MCP view model did.** Rejected: then the count on the tab and the rows behind it come from different code. One predicate now produces both.
- **Match the prototype's 6px filter-segment radius and 4px tag radius with local CSS.** Rejected in favour of the host `Pill` and `Tag`: the platform's capsule geometry and tone palette are what keep this surface looking native, and a local re-implementation has to re-earn the dark-mode behaviour the tokens already provide.
- **Keep the toolbar wrapping at 700px.** Rejected: that threshold stacks the toolbar at the real 564px column, which the prototype never does; the search field absorbs the squeeze instead, and the wrap moved down to 480px where the segments would genuinely overflow.

## Risks

- A card's identity row now reserves a fixed 88px, so a future surface with a wider action cluster has to update that reserve (or opt into the switch-only 46px) rather than letting the grid measure it.
- The MCP enable override is written per source-qualified suite, so the same server key in two sources stays independently switchable; a future rename of a source id would orphan its override record the same way the existing `mcp-overrides` records already could.
- Two new locale keys per language plus two filter hints ride the existing bilingual parity test.

## Verification

- `pnpm run check:refactor` green (typecheck × 4, eslint, prettier, contract tests, dependency-cruiser 147 modules / 527 dependencies); `pnpm run test` 82 files / 638 tests green; `pnpm run build` succeeds.
- Isolated-profile walkthrough (`dsh --profile ui-check --port 3101` with `DSH_AGENTS_HOME` pointed at a scratch directory), zero console errors: two 274px columns 4px apart in a 564px column; the cluster hidden by default and revealed on hover with zero movement; the MCP switch driven end to end (`error` → `disabled` + `已禁用` → back); the source strip's overlay covering the toolbar and the first card row; light and dark themes both correct.
