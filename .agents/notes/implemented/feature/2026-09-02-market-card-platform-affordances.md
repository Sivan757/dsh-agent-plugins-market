# Agent Note: Market suite card affordances ride the platform design language

Status: implemented

## Problem

The market suite card diverged from the harness's own card language in two ways:

1. **Eleven `--dsw-*` custom properties used across the client CSS were never defined by the harness theme.** They were leftovers from the plugin's pre-platform palette (`--dsw-alias-bg-hover`, `--dsw-alias-bg-selected`, `--dsw-alias-bg-success`/`-warn`/`-error`, `--dsw-alias-state-neutral`, `--dsw-alias-danger`, `--dsw-alias-text-2`, `--dsw-alias-accent`, `--dsw-alias-border`). Nothing defines them at runtime, so every one of their fallbacks was permanently active — including hard-coded grays that never adapt in dark mode. The canonical token set lives in the harness checkout at `packages/client/ui-theme/src/styles/design-platform.css`.
2. **The suite card's installed state was invisible at grid-scanning distance.** Install state was carried only by a text badge (`✓ 已安装`) in the tag row, the refresh/uninstall actions were ghost `Button`s (chrome boxes around glyphs), and the enable toggle sat in the middle of the action cluster. The MCP status page had already solved the same problem with a colored left border plus a trailing toggle.

## Decision

- **Token alignment.** Every undefined token was remapped to its design-platform counterpart (fallbacks updated to the platform's light values): `bg-hover`/`bg-active` → `interactive-bg-hover`/`-active`; `bg-selected` → `state-business-tertiary`; `bg-success`/`bg-warn` → `state-success-tertiary`/`state-warn-tertiary`; `bg-error` → `interactive-bg-hover-danger`; `state-neutral` (toggle-off track) → `label-dimmed` (the harness's own switch track uses `border-l2`, too faint at this control's 38×22 size); `danger` splits by context — warn box → `state-warn-label`, destructive hover → `state-error-primary`; `text-2` → `label-secondary`; `accent` → `brand-primary-new-colorprimary-new-color`; `border` → `border-l2`.
- **Card affordances mirror the MCP card.** Installed suites get a 3px left accent — success green when enabled, `label-tertiary` gray when disabled; uninstalled suites get no accent. The card also gains the MCP card's hover treatment (border-l3, interactive-bg-hover, soft shadow) since the whole card opens the suite detail.
- **Actions flatten.** Refresh and uninstall are inline flat icon buttons (transparent fill, `interactive-bg-hover` on hover, destructive hover tint for uninstall) following the harness `Button` ghost geometry; the enable toggle moves to the card's trailing edge. The install/add-source CTA stays a primary text button.
- **The `✓ 已安装` badge is gone** — the accent bar now carries install state, and the toggle carries enable state; saying both again in text was redundant. `installedBadge` stays in locales (the suite detail panel still uses it), and surface-count tags move to their own row below `source · layout`.

## Alternatives considered

- Defining the eleven legacy tokens locally in the plugin (a compat stylesheet) was rejected: it would fork the palette from the platform instead of riding it, and the platform already ships the right aliases for every use.
- Keeping the text badge next to the accent bar was rejected: two encodings of one state invite drift, and the badge was the only reason the tag row mixed identity tags with state.
- Reusing the harness `Button` component with `variant: 'ghost'` for the icon actions was rejected: it pads capsule chrome around glyph-only content, which is exactly the box the redesign removes.

## Risks

- The toggle-off track color changed (`#d1d5db` → `label-dimmed`); it is slightly lighter in light mode but now adapts in dark mode.
- Suite cards now show hover affordance even where the card click was already active; behavior is unchanged, only discoverability improves.

## Verification

- `grep` audit: zero `var(--dsw-*)` references in `src/client` fall outside the set defined by `design-platform.css`.
- `pnpm run typecheck`, `lint`, `format:check`, and `test:contract` green after the change.
