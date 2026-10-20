# Agent Note: The settings switches default on and carry no experimental label

Status: implemented Date: 2026-10-19

## Problem

Two rows of the settings card were gated. The Agent preset manager was off until the user found the switch, and both that row and the translation row carried an 实验性 / Experimental tag that read as a warning about a feature the plugin already ships. The translation row also derived its default from the interface language: `resolveMarketSettings` took the locale preference and `interfaceLanguageTranslates` answered the absent case, so Chinese started on and English started off.

A user who never opened the settings page therefore saw no preset entry, and the interface language decided whether translation ran at all.

## Decision

Both switches are on by default, and neither row carries a tag.

- `MARKET_SETTINGS_DEFAULTS.translationEnabled` and `MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled` are `true` in `packages/market-contracts/src/contracts/settings.ts`, which the namespace schema in `packages/market-bundle/src/platform/settings-schema.ts` states to the host.
- The language-derived translation default is removed. `resolveMarketSettings(section)` takes one argument and answers absence from the constant; `interfaceLanguageTranslates` is deleted. `resolveTranslationTarget` still selects the language translations are written in, and that stays independent of whether they are displayed.
- `translationEnabled` still declares no default in the schema. The field stays out of the resolved section until the user writes it, which is what keeps an untouched field distinguishable from a stored `false` for the customized badge and **Use default**. The constant answers the absent case.
- The card renders the two rows without a tag. `FieldHead` keeps only the override badge, the two locale keys are removed from both dictionaries, and the browser no longer reads `locale.preference` to resolve a default.
- A stored `false` still wins for both fields, as it does for every switch.

## Alternatives considered

- **Keep the language-derived default and flip only the preset switch.** Rejected: the request names both rows, and one field with its own derivation rule inside an otherwise uniform namespace is the second reading of "what does absent mean" this contract exists to prevent.
- **Keep the tag and default the switch on.** Rejected: the tag marks an opt-in. With the capability on for everyone it would label a feature the user already has, and it would contradict the row it sits on.
- **Declare a schema default for `translationEnabled` now that the default is constant.** Rejected: the declared absence still distinguishes an untouched field from one the user set, and that distinction drives the customized badge and the reset path. A constant default answers the absent case without materializing it.
- **Remove the two switches.** Rejected: both remain user choices. The preset manager entry stays optional, and translation still spends provider requests the user may not want.
- **Delete the language plumbing in the node half.** Rejected: the market's own copy still follows `locale.preference`. Only the default derivation read it.

## Consequences

- A fresh install of either interface language translates suite, skill, command, agent, MCP and LSP text and shows the Agent preset manager entry without visiting the settings page.
- An English installation now spends provider requests on translation by default. Turning it off is one switch, and the translation cache reset still exists.
- A stored `false` wins for both fields, so a user who answered the question keeps that answer.
- The experimental wording is gone from the card and the guides; no code path reads a language to decide a settings default.
- The [translation default note](../../archived/feature/2026-10-05-translation-default-follows-language.md) is archived: its language-derived default is reversed here.

## Testing

`packages/market-bundle/test/settings-namespace.test.ts` asserts both defaults with an absent section. `packages/market-bundle/test/integration/translation-gate-consistency.test.ts` asserts the switch resolves on for every interface language and that a stored boolean wins, while the target still follows the language. `packages/market-bundle/test/integration/client-plugin-card.test.ts` asserts neither row renders a tag, `client-translation-settings.test.ts` covers the browser preference, and `packages/market-ui/test/client-agent-presets-gate.test.ts` covers the preset gate.

## Related decisions

[Settings and the config card ride the host](../architecture/2026-09-13-settings-and-card-ride-the-host.md) owns where defaults live and how the card binds them.
