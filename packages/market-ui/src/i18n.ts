/**
 * The translator contract every UI module renders through.
 *
 * A leaf module on purpose. Components, helpers and feature modules import this
 * file directly, so none of them has to reach the plugin entry for a type —
 * which is what kept the entry and its own feature modules mutually dependent.
 * The entry re-exports it, so a consumer outside the UI keeps one import path.
 * @module client/i18n
 */
import type { LocaleKey } from './locales.js'
import type { ExtensionPresetLocaleKey } from './locales-extension-presets.js'

/** Render one localized string; `params` fill the dictionary's placeholders. */
export type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** Resource surfaces use both the preset and settings dictionaries. */
export type ExtensionTranslate = (key: ExtensionPresetLocaleKey | LocaleKey, params?: Record<string, unknown>) => string
