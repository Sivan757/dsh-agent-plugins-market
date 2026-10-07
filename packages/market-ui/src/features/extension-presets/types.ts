/**
 * The preset manager's translator contract.
 *
 * A leaf module so the entry, the list and the detail renderers can share the
 * one type without importing each other: the type names keys from both the
 * preset dictionary and the market dictionary, and the entry that produced it
 * re-exports it for consumers that already import from there.
 * @module client/features/extension-presets/types
 */
import type { LocaleKey } from '../../locales.js'
import type { ExtensionPresetLocaleKey } from '../../locales-extension-presets.js'

/** Render one preset-manager string from the preset dictionary or the market dictionary. */
export type ExtensionTranslate = (key: ExtensionPresetLocaleKey | LocaleKey, params?: Record<string, unknown>) => string
