# Agent Note: The translation switch defaults to the interface language

Status: implemented

## Problem

The translation switch needs to default to on for Chinese and off for English while preserving an explicit on or off. Derivation must distinguish “the user turned it off” from “the user never set it”.

The stored field distinguishes on, off and absent. Only absence takes the language default. A schema declaration of `.default(false)` makes the resolved live reference treat absence like explicit false. Deriving a language default from that reference can override a deliberate off.

## Decision

The translation switch is a stored boolean whose default follows the host's `locale.preference`. A stored boolean always wins; only a section that says nothing about the field takes the language's answer.

`interfaceLanguageTranslates(localePreference)` (`src/contracts/settings.ts`) answers only the default: like `bindHostLocale`, preferences starting with `en` use English and all others, including absence, use Chinese. `resolveMarketSettings` takes the stored boolean first and this default second. [Three-mode reading and translation lifecycle](2026-10-06-translation-reading-and-lifecycle.md) partially supersedes this note's language-as-gate decision: `resolveTranslationTarget` selects the target independently, and the effective switch controls work.

### The absence signal is the schema's

`MarketSettingsFields.translationEnabled` declares no default (`src/application/mcp/mcp-backend.ts`). An untouched document therefore leaves the field out of the resolved section, the volatile reference answers `undefined`, and `narrowBoolean` hands the field to the language. This is the one field in the namespace without a declared default, and the absence is load-bearing rather than an omission: a declared default would erase the distinction the derivation rests on.

The host's own language row is shaped the same way: `locale.preference` is declared `.required(false)`, and its absence means "follow the browser".

### Both halves read the same language

The node half passes the cached `locale.preference` it already holds for its own copy (`src/index.ts`, refreshed on activation, on the settings service landing, and on the locale entry's own document update) into `MarketSettingsNamespace`.

The browser reads the locale preference through the configuration transport, not the locale service active id derived from the browser. The node process renders Chinese when the preference is absent. Following an English browser alone can show off while the server translates into Chinese. Both halves resolve an absent preference to `zh`.

### The card shows the effective value

The host provides no switch value for an absent field. `bindMarketCardForm` projects the effective default into the draft display and republishes it when the language changes. A staged user edit takes priority. The customized badge still reflects the presence of a user-layer field, and restoring the default removes that override.

### The row's controls

Cache reset uses the host's `Button`, labelled 重置缓存 / `translationReset`, and shows `translationResetDone` when complete. The setting description covers descriptions and document prose, unchanged names, and the language-derived default.

## Alternatives considered

**Add a third “follow interface language” switch value.** Rejected: download region is an enum, so its segmented control can show an automatic value. A boolean switch has no third state. Replacing the control broadens the change when field absence already selects the default.

**Keep the schema default and read the user layer from the host descriptor.** Rejected: each read needs a whole-profile projection and duplicates the client-side field-presence test. It also leaves the schema declaring a default that the plugin ignores.

**Write the derived value into the document when the language changes.** Rejected: it turns the derivation into a stored value, so the field could no longer follow a later language switch, and the plugin would be writing the user's settings document on its own initiative.

**Derive in the browser from the locale service's active locale id.** Rejected: it answers the browser-derived language rather than the host's stored preference, so an English browser with no stored preference would hide the switch while the node half translated into Chinese.

**Show only the stored value and add a hint line naming the language default, the way the region row shows its resolved route.** Rejected: the row would read "off" while translation ran, and a hint cannot repair a switch that contradicts itself.

**Align the default with the download-region predicate (`startsWith('zh')`).** Rejected: the region selects a download route, while the translation default follows the dictionary the interface uses. Both `ja` and `zh-Hant` use Simplified Chinese in this plugin; reading their tags directly would disagree with the interface copy and target. That does not authorize overriding an explicit preference.

**Change the node half's "an absent preference means zh" convention to follow the browser language.** Rejected: it is a repository-wide convention (`src/runtime/host/host-locale.ts`) the market's own copy already relies on, and the node process has no browser language to read. Changing it for one setting would put the market's copy and its translation default in disagreement.

## Consequences

A fresh Chinese deployment translates without visiting the settings page, an English one is untouched, and a language switch moves the default only for the users who never answered the question themselves. A stored answer is never overwritten in either direction.

`interfaceLanguageTranslates` owns the effective default, so `MARKET_SETTINGS_DEFAULTS` alone cannot explain an absent field. The client needs a projection that displays this default. Both halves must read `locale.preference` with the same absence rule.

One edge is inherited rather than introduced: with no stored preference and a non-Chinese browser, the market still reads as Chinese, because absence means zh everywhere in this plugin. The market's own copy already renders Chinese there, so the switch follows it rather than contradicting it.

The target is normalized to `zh` or `en`, not the raw preference tag, so `zh`, `zh-CN`, `zh-Hant` and `ja` share the Chinese target cache. English starts off but can translate Chinese when explicitly enabled. The default is not a hard translation gate; [the replacement decision](2026-10-06-translation-reading-and-lifecycle.md) owns that distinction.

## Testing

[Schema tests](../../../../tests/mcp-backend.test.ts) cover absence versus explicit false; [settings namespace tests](../../../../tests/settings-namespace.test.ts) cover language defaults and overrides. [Target-consistency tests](../../../../tests/translation-gate-consistency.test.ts) distinguish default-off English from an explicitly enabled English target. [Client setting tests](../../../../tests/client-translation-settings.test.ts), [card tests](../../../../tests/client-plugin-card.test.ts) and [setting item tests](../../../../tests/client-plugins-item-views.test.ts) cover bindings, effective-value projection and the reset control. These identify coverage owners, not behavior tests rerun by this documentation edit.

## Related

[The universal layer](2026-10-04-universal-translation-layer.md) owns the provider chain, cache and surfaces. [The configuration and card note](../../implemented/architecture/2026-09-13-settings-and-card-ride-the-host.md) owns namespace resolution. Translation is the exception whose schema does not declare a constant default. [The reading and lifecycle note](2026-10-06-translation-reading-and-lifecycle.md) partially supersedes the language gate but retains absence detection and explicit-choice priority.
