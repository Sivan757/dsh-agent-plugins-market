/**
 * Read-only agent-preset-manager preference shared by the composer slot. The
 * host form owns persistence; this projection carries the resolved boolean —
 * the experimental capability is hidden until the user turns it on, and a
 * flip shows the entry without a reload.
 * @module client/ui/agent-presets-enabled
 */
import { useSyncExternalStore } from 'react'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { MARKET_SETTINGS_DEFAULTS, resolveMarketSettings } from '../../contracts/settings.js'

/** The host form's observable value; it is absent before the first answer. */
export type AgentPresetsEnabledSource = ObservableSnapshot<{ value?: { agentPresetsEnabled?: boolean } | undefined }>

const state = createSnapshotStore(MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled)
let binding: object | undefined
let unsubscribeSource: (() => void) | undefined

/** Shared read and subscription API. Consumers cannot write the preference. */
export const agentPresetsEnabled = {
  getSnapshot: (): boolean => state.getSnapshot(),
  subscribe: (listener: () => void): (() => void) => state.subscribe(listener)
} satisfies ObservableSnapshot<boolean>

/**
 * Follow the host form without adding persistence or polling. A form that has
 * not answered yet keeps the pre-answer default (off) rather than resolving
 * the absent section: only a defined value is resolved through the contract.
 * @param next - the host form for this plugin's settings namespace.
 * @returns an idempotent disposer; an older disposer cannot clear a newer binding.
 */
export function bindAgentPresetsEnabled(next: AgentPresetsEnabledSource): () => void {
  unsubscribeSource?.()
  const current = {}
  binding = current
  const sync = (): void => {
    if (binding !== current) return
    const answered = next.getSnapshot().value
    if (answered === undefined) {
      state.set(MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled)
      return
    }
    state.set(resolveMarketSettings(answered).agentPresetsEnabled)
  }
  unsubscribeSource = next.subscribe(sync)
  sync()
  return () => {
    if (binding !== current) return
    binding = undefined
    unsubscribeSource?.()
    unsubscribeSource = undefined
    state.set(MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled)
  }
}

/** Read the same preference the non-React binding subscribes to. */
export function useAgentPresetsEnabled(): boolean {
  return useSyncExternalStore(agentPresetsEnabled.subscribe, agentPresetsEnabled.getSnapshot, () => MARKET_SETTINGS_DEFAULTS.agentPresetsEnabled)
}
