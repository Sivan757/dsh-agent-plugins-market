/**
 * Read-only translation preference shared by panels and menu integrations.
 * The host form owns persistence; this projection carries the resolved boolean
 * — the user's stored value while they have one, the interface language's
 * default otherwise — across late binding and namespace replacement. It is the
 * display preference in both supported interface languages; target-language
 * selection does not override an explicit on or off.
 * @module client/ui/translation-enabled
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Translate } from '../index.js'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { MARKET_SETTINGS_DEFAULTS, resolveMarketSettings } from '../../contracts/settings.js'

/** The host form's observable value; it is absent before the first answer. */
export type TranslationEnabledSource = ObservableSnapshot<{ value?: { translationEnabled?: boolean } | undefined }>

/**
 * The interface language the derived default follows.
 *
 * It is the host's own language row rather than the locale service's active id:
 * the market's node half resolves the same `locale.preference` when it decides
 * whether to translate, and a switch answering a different language than the
 * text it describes would report a state the market is not in.
 */
export interface InterfaceLanguage {
  /** The host interface language: `locale.preference`, or zh while the row holds none. */
  current(): string
  /** Observe a language switch. */
  subscribe(listener: () => void): () => void
}

/** The slice of one host config form the interface language is read from. */
export interface InterfaceLanguageForm {
  getSnapshot(): { value?: { preference?: unknown } | undefined }
  subscribe(listener: () => void): () => void
}

/** The settings entry the harness locale plugin owns; the node half names the same entry. */
export const LOCALE_SETTINGS_ENTRY = 'locale'

/**
 * Read the interface language off the locale plugin's settings form.
 *
 * An absent preference reads as zh — the rule every host-facing read gives it
 * (`runtime/host/host-locale.ts`), so the derived default cannot disagree with
 * the language the market renders its own copy in.
 * @param form - the host form for the `locale` entry.
 * @returns the language source the derived default follows.
 */
export function bindInterfaceLanguage(form: InterfaceLanguageForm): InterfaceLanguage {
  return {
    current: () => {
      const preference = form.getSnapshot().value?.preference
      return typeof preference === 'string' ? preference : 'zh'
    },
    subscribe: listener => form.subscribe(listener)
  }
}

const state = createSnapshotStore(MARKET_SETTINGS_DEFAULTS.translationEnabled)
let binding: object | undefined
let unsubscribeSource: (() => void) | undefined
let unsubscribeLanguage: (() => void) | undefined

/** Shared read and subscription API. Consumers cannot write the preference. */
export const translationEnabled = {
  getSnapshot: (): boolean => state.getSnapshot(),
  subscribe: (listener: () => void): (() => void) => state.subscribe(listener)
} satisfies ObservableSnapshot<boolean>

/**
 * Whether translation is on for one stored section under one interface
 * language: the user's stored boolean, else the language's default.
 * @param section - the host form's accepted section.
 * @param language - the host interface language; absent keeps the declared default.
 */
export function effectiveTranslationEnabled(section: unknown, language: string | undefined): boolean {
  return resolveMarketSettings(section, language).translationEnabled
}

/**
 * Follow the host form and the interface language without adding persistence or
 * polling. Replacing a binding disconnects its sources, not the existing
 * consumers.
 *
 * A form that has not answered yet keeps the pre-answer default rather than
 * resolving the absent section: the language-derived default describes a
 * section the host has answered and deliberately left open, and publishing it
 * before the answer would flash a control the user may have turned off. Only a
 * defined value is resolved through the contract.
 * @param next - the host form for this plugin's settings namespace.
 * @param language - the interface language the derived default follows; absent keeps the declared default.
 * @returns an idempotent disposer; an older disposer cannot clear a newer binding.
 */
export function bindTranslationEnabled(next: TranslationEnabledSource, language?: InterfaceLanguage): () => void {
  unsubscribeSource?.()
  unsubscribeLanguage?.()
  const current = {}
  binding = current
  const sync = (): void => {
    if (binding !== current) return
    const answered = next.getSnapshot().value
    // No answer yet: hold the pre-answer default instead of reading the absent
    // section as one the document deliberately left open.
    if (answered === undefined) {
      state.set(MARKET_SETTINGS_DEFAULTS.translationEnabled)
      return
    }
    state.set(effectiveTranslationEnabled(answered, language?.current()))
  }
  unsubscribeSource = next.subscribe(sync)
  unsubscribeLanguage = language?.subscribe(sync)
  sync()
  return () => {
    if (binding !== current) return
    binding = undefined
    unsubscribeSource?.()
    unsubscribeLanguage?.()
    unsubscribeSource = undefined
    unsubscribeLanguage = undefined
    state.set(MARKET_SETTINGS_DEFAULTS.translationEnabled)
  }
}

/** Revalidate mounted panel data once when its language or display preference changes. */
export function useTranslationRefresh(t: Translate, refresh: () => void | Promise<void>): void {
  const enabled = useTranslationEnabled()
  const language = t('localeProbeLang')
  const previous = useRef({ enabled, language })
  const read = useRef(refresh)
  read.current = refresh
  useEffect(() => {
    if (previous.current.enabled === enabled && previous.current.language === language) return
    previous.current = { enabled, language }
    void read.current()
  }, [enabled, language])
}

/** Read the same preference the non-React menu integration subscribes to. */
export function useTranslationEnabled(): boolean {
  return useSyncExternalStore(translationEnabled.subscribe, translationEnabled.getSnapshot, () => MARKET_SETTINGS_DEFAULTS.translationEnabled)
}
