import { useState } from 'react'
import { HOOK_EVENT_HOST_SUPPORT, type ExtensionResource } from '../../../market-contracts/src/contracts/extension-presets.js'

/**
 * The one hooks presentation model both surfaces share: events in first-seen
 * order, one active event, and the honest support dot. The manager passes its
 * session selection so enabled events read green; the settings page omits it,
 * so supported events read gray and limited ones warn.
 */
export function useHookEvents(rows: ExtensionResource[], isSelected: ((row: ExtensionResource) => boolean) | undefined) {
  const events = [...new Set(rows.map(row => row.description ?? ''))].filter(Boolean)
  const [requested, setRequested] = useState('')
  const active = events.includes(requested) ? requested : (events[0] ?? '')
  const dotFor = (name: string): 'done' | 'idle' | 'warning' => {
    const support = HOOK_EVENT_HOST_SUPPORT[name] ?? 'registered-only'
    if (support !== 'supported') return 'warning'
    return isSelected !== undefined && rows.some(row => row.description === name && isSelected(row)) ? 'done' : 'idle'
  }
  return { events, active, setRequested, rowsFor: (name: string) => rows.filter(row => (row.description ?? '') === name), dotFor }
}
