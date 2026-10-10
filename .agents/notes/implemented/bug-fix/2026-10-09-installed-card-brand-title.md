# Agent Note: The Installed card shows the localized brand title

Status: implemented

## Problem

The Installed card showed the npm package name `dsh-agent-plugins-market` where every other plugin shows what a person calls it. The card is the first thing a reader sees in the Plugins page, so the row read as a build artifact rather than as the product, and the documented entry (`Plugins → Installed → Agent Plugins`) did not match the screen.

## Decision

Both exported locale resources carry `meta.title`: `Agent Plugins` in `locale/en.json` and `Agent 扩展` in `locale/zh.json`. The published host renders a package card as `meta.title` when it is present and falls back to the package name when it is absent, so the Installed card now reads as the product and follows the interface language.

The technical identity keeps exactly one home: the package page below the card still prints `dsh-agent-plugins-market` in the `data-plugin-name` line, and the row id and module name of the bundle's own row remain untouched. The card title, the enable switch label, the open-detail label, and the uninstall confirmation all follow the same localized title.

This reverses the `meta.title` removal in [localized Agent Plugins branding and bundle settings](../feature/2026-10-04-agent-plugins-branding.md). Everything else in that note stands: the icon asset, the `plugins.bundle.config` binding, the description resources, and the npm identity.

## Alternatives considered

**Keep the description-only metadata.** This was the previous state. Its rationale was that the host renders a row as its title plus any technical id that differs from it, so a brand title produced two id lines. That reasoning applies to the bundle's _rows_ under the package, not to the package card itself, and it left the card showing a package name. Reinstating the title fixes the card; the row list keeps its own ids.

**Shorten the package name in `package.json`.** The published name is the install identity and the settings namespace. Renaming it breaks existing profiles, the patch file, and the settings keys.

**Rename the row id in `cordis.patch.yml`.** The row id is the configuration key (`<package>#<rowId>`) and the profile override address. Changing it would strand every saved setting for no visible gain, because the card title does not read the row id.

## Consequences

- The Installed card, its switch labels, and the uninstall confirmation read `Agent 扩展` or `Agent Plugins` according to the interface language. Both languages are pinned by `tests/package-branding.test.ts`.
- The package page keeps printing the npm name, so the card and the page together show the brand and the technical identity exactly once each.
- No runtime dependency, settings store, or profile change is introduced. The host reads the packaged locale resources without evaluating plugin code, so the title is available even while the plugin is disabled.
- The bundle's own row on the package page prints its technical ids again. The row id and the module name are both `dsh-agent-plugins-market`, and the host prints each one that differs from the title, so that row shows the string twice under the brand title. Changing the row id would avoid it, but the row id is the configuration key (`<package>#<rowId>`) and the profile override address, so a rename would strand saved settings. The duplicate line is the accepted cost of the brand title.
- A reader who searches the Plugins page for the npm name still finds the package: the card's own page carries it in the row list.

## Testing

`tests/package-branding.test.ts` asserts `meta.title` equals the localized `nav` label and `meta.description` equals `marketCardDesc` for both languages. The installed host validator was run against the desktop profile and returned `{"en":"Agent Plugins","zh":"Agent 扩展"}` with no metadata error.
