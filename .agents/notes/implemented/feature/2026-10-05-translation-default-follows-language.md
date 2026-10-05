# Agent Note: The translation switch defaults to the interface language

Status: implemented

## Problem

The translation layer was opt-in: `translationEnabled` declared `false`, so a Chinese deployment — the only interface the layer translates for, since an English panel already shows the authored text — opened every panel on authored English until the user found the switch on a settings page they had no reason to visit. The user asked for the download region's shape instead: follow the interface language, Chinese on, English off.

The default was the whole difficulty. A stored settings section has three states to a reader — the user turned the field on, the user turned it off, and the user has never touched it — and a derivation may only move the third. The plugin's own config reference could not tell the third from the second: `MarketSettingsFields.translationEnabled` declared `.default(false)`, and schemastery materializes a declared default into the live volatile reference, so an untouched field read `false` exactly like a stored one. Measured on `@deepseek-ai/schemastery@3.18.4`: a schema carrying the default resolves an absent field to `false`, and the same schema without it resolves to `undefined`. Deriving on top of that reference would have silently re-enabled the feature for every user who had deliberately turned it off.

## Decision

The translation switch is a stored boolean whose default follows the host's `locale.preference`. A stored boolean always wins; only a section that says nothing about the field takes the language's answer.

`interfaceLanguageTranslates(localePreference)` in `src/contracts/settings.ts` owns the rule, and it is the host's own rule rather than a second reading of it: `bindHostLocale` (`src/runtime/host/host-locale.ts`) answers every preference that is not English with the Chinese dictionary, so every interface that is not English translates, an absent preference included. `resolveMarketSettings(section, localePreference)` applies it to the switch, and `Catalog.translateFields` and `Catalog.translateDocument` are gated by that same function — which is what makes "the switch reads on" and "the text is translated" one statement instead of two that can drift apart.

### The absence signal is the schema's

`MarketSettingsFields.translationEnabled` declares no default (`src/application/mcp/mcp-backend.ts`). An untouched document therefore leaves the field out of the resolved section, the volatile reference answers `undefined`, and `narrowBoolean` hands the field to the language. This is the one field in the namespace without a declared default, and the absence is load-bearing rather than an omission: a declared default would erase the distinction the derivation rests on.

The host's own language row is shaped the same way: `locale.preference` is declared `.required(false)`, and its absence means "follow the browser".

### Both halves read the same language

The node half passes the cached `locale.preference` it already holds for its own copy (`src/index.ts`, refreshed on activation, on the settings service landing, and on the locale entry's own document update) into `MarketSettingsNamespace`.

The browser half reads the locale plugin's form through the settings transport (`bindInterfaceLanguage` in `src/client/ui/translation-enabled.ts`) rather than the locale service's active id. The active id is the browser-derived language, while the market's node half renders Chinese copy whenever the preference is absent (`src/runtime/host/host-locale.ts`); a switch answering the browser's language would report "off" while the market was translating into Chinese. An absent preference reads as `zh` on both sides, the rule every host-facing read already gives it.

### The card shows the effective value

Removing the declared default also removed the value the card used to render, and a switch left empty would have read "off" beside text the market was translating — a control lying about the state it reports. `bindMarketCardForm` projects the row's draft text from the effective value whenever the model has none of its own (`translationField()` in `src/client/features/settings-card/market-card-form.ts`), and republishes on a language switch. The override badge is unchanged: it still reports the presence of a user-layer entry, which is what a reset hands the field back to.

### The row's controls

The cache reset is the host's `Button` in the ghost/small variant, labelled 重置缓存 / `translationReset`, settling on `translationResetDone` once the clear resolves. The flat icon button it replaced is gone, with the local `.pluginFieldIcon` rule it used. `translationToggleDesc` now describes what the layer does — descriptions only, names stay as authored — and states the language default, which is the one place a reader learns that the switch follows the language.

## Alternatives considered

**A third "follow the interface language" value on the switch, mirroring `downloadRegion`'s `auto`.** Rejected: the region is an enum rendered as a segmented control, which has a segment to show "follow" and a resolved-value line beneath it. A boolean switch has no third state, so this would have meant replacing the switch with a segmented control — a larger surface change than the default itself, and one the user did not ask for.

**Keep the declared default and read the user layer off the host settings descriptor (`describe().user`).** Rejected: it answers the same question through a whole-profile projection on every read (the plugin's locale read already pays one and caches it), it duplicates the discriminator the browser half reads as `user` presence, and it leaves the schema asserting a default the plugin then ignores.

**Write the derived value into the document when the language changes.** Rejected: it turns the derivation into a stored value, so the field could no longer follow a later language switch, and the plugin would be writing the user's settings document on its own initiative.

**Derive in the browser from the locale service's active locale id.** Rejected: it answers the browser-derived language rather than the host's stored preference, so an English browser with no stored preference would hide the switch while the node half translated into Chinese.

**Show only the stored value and add a hint line naming the language default, the way the region row shows its resolved route.** Rejected: the row would read "off" while translation ran, and a hint cannot repair a switch that contradicts itself.

**Align the switch with the download region's predicate (`startsWith('zh')` in `src/application/regions.ts`).** Rejected: the region answers which route to download over, while the translation question is which dictionary the interface renders — and the host answers that one itself, in `bindHostLocale`. The region's predicate would have read `ja` as "not Chinese" while the host renders it with the Chinese dictionary, leaving the switch off on an interface whose text the layer translates, and the layer's own gate still compared the locale to the exact `zh`, so a `zh-CN` interface would have shown a switch reading "on" over text nothing translated. The gate and the switch now share the host's rule instead.

**Change the node half's "an absent preference means zh" convention to follow the browser language.** Rejected: it is a repository-wide convention (`src/runtime/host/host-locale.ts`) the market's own copy already relies on, and the node process has no browser language to read. Changing it for one setting would put the market's copy and its translation default in disagreement.

## Consequences

A fresh Chinese deployment translates without visiting the settings page, an English one is untouched, and a language switch moves the default only for the users who never answered the question themselves. A stored answer is never overwritten in either direction.

The costs are three. The namespace has one field whose default is not in `MARKET_SETTINGS_DEFAULTS` alone, so a reader asking "what does an absent field mean" now needs `translationDefaultEnabled` as well. The browser card carries a projection for that one field, because the host serves nothing for it. And each half resolves the language from its own side of the process; they agree because both read `locale.preference` under the same absence rule, which is what the tests pin.

One edge is inherited rather than introduced: with no stored preference and a non-Chinese browser, the market still reads as Chinese, because absence means zh everywhere in this plugin. The market's own copy already renders Chinese there, so the switch follows it rather than contradicting it.

The gate moved with the switch. `Catalog.translateFields` and `Catalog.translateDocument` had compared the locale to the exact `zh` and now call the predicate, so a `zh-CN`, `zh-Hant` or `ja` interface translates its descriptions and its document bodies instead of showing a switch that lies. The cost is one cache space per target locale: `translationKey` folds the locale into the key, so a reader who switches between `zh` and `zh-CN` pays one translation per text per target they actually read. That is the key's own design — a different target is a different answer, not a stale one — and the same text is still queued once per target, never twice.

## Testing

`tests/mcp-backend.test.ts` pins the schema's missing default: an untouched section leaves the field undefined while an explicit `false` stays `false`. `tests/settings-namespace.test.ts` covers the derivation on the node half — zh, zh-CN, zh-Hant and ja on, en and en-US off, an absent reference resolving to the language rather than to a constant, a stored value holding in both directions, and a language switch moving an unset field while leaving a set one alone. `tests/translation-gate-consistency.test.ts` is the anti-drift test: for each of those locales it drives the real gate through `Catalog.translateFields` — whether a provider was called, what the read reported pending, and what the settled read returned — and asserts the answer is the switch's own, with a second case doing the same for `translateDocument`. `tests/client-translation-settings.test.ts` covers the browser binding: the same language cases through `bindInterfaceLanguage`, an absent preference reading as zh, a binding wired without a language source following that same reading, and a language switch under a stored value. `tests/client-plugin-card.test.ts` covers the card's effective-value projection, including a language switch republishing the row, a staged edit answering for itself, and a saved "off" surviving a switch back to Chinese. `tests/client-plugins-item-views.test.ts` covers the reset control: the row renders a named text button with no icon, and a click clears the cache and settles on the cleared label.

## Related

The layer itself is recorded in [the universal translation layer note](2026-10-04-universal-translation-layer.md), which owns the chain, the cache and the six surfaces; this note changes the switch's default and the settings row, and adds no layer mechanism. That note states no default, so nothing in it is superseded. [The settings-and-card note](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md) owns the namespace's defaults-and-resolution arrangement; its statement that the schema declares every default now holds for every field but this one.
