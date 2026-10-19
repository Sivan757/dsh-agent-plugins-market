/**
 * Read-only translation preference shared by panels and menu integrations.
 * The host form owns persistence; this projection carries the resolved boolean
 * — the user's stored value while they have one, the plugin default otherwise
 * — across late binding and namespace replacement. The switch is on by default
 * in every interface language; target-language selection does not override an
 * explicit on or off.
 * @module client/ui/translation-enabled
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Translate } from '../i18n.js'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { MARKET_SETTINGS_DEFAULTS, resolveMarketSettings } from '../../../market-contracts/src/contracts/settings.js'

/** The host form's observable value; it is absent before the first answer. */
export type TranslationEnabledSource = ObservableSnapshot<{ value?: { translationEnabled?: boolean } | undefined }>

const state = createSnapshotStore(MARKET_SETTINGS_DEFAULTS.translationEnabled)
let binding: object | undefined
let unsubscribeSource: (() => void) | undefined

/** Shared read and subscription API. Consumers cannot write the preference. */
export const translationEnabled = {
  getSnapshot: (): boolean => state.getSnapshot(),
  subscribe: (listener: () => void): (() => void) => state.subscribe(listener)
} satisfies ObservableSnapshot<boolean>

/**
 * Whether translation is on for one stored section: the user's stored boolean,
 * else the plugin default the contract declares.
 * @param section - the host form's accepted section.
 */
export function effectiveTranslationEnabled(section: unknown): boolean {
  return resolveMarketSettings(section).translationEnabled
}

/**
 * Follow the host form without adding persistence or polling. Replacing a
 * binding disconnects its source, not the existing consumers.
 *
 * A form that has not answered yet keeps the pre-answer default rather than
 * resolving the absent section: the declared default describes a section the
 * host has answered and deliberately left open, and reading an absent section
 * as one the document left open would report a state the document may not be
 * in. Only a defined value is resolved through the contract.
 * @param next - the host form for this plugin's settings namespace.
 * @returns an idempotent disposer; an older disposer cannot clear a newer binding.
 */
export function bindTranslationEnabled(next: TranslationEnabledSource): () => void {
  unsubscribeSource?.()
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
    state.set(effectiveTranslationEnabled(answered))
  }
  unsubscribeSource = next.subscribe(sync)
  sync()
  return () => {
    if (binding !== current) return
    binding = undefined
    unsubscribeSource?.()
    unsubscribeSource = undefined
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
