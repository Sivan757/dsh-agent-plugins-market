import { type Translate } from '../../i18n.js'
import type { McpStatusEntry } from '../../api.js'
import type { ResourceState } from '../../ui/ResourceCard.js'

/**
 * The inventory card's state for one row. The detail band derives its edge and
 * dot from this same value, so a service cannot read one colour on its card and
 * another in its detail dialog.
 */
export function mcpCardState(state: McpStatusEntry['state']): ResourceState {
  if (state === 'connected') return 'active'
  if (state === 'disabled') return 'disabled'
  if (state === 'failed' || state === 'orphaned') return 'error'
  return 'warning'
}

export function mcpTagTone(state: McpStatusEntry['state']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'connected') return 'success'
  if (state === 'failed' || state === 'orphaned') return 'danger'
  if (state === 'disabled' || state === 'foreign') return 'neutral'
  return 'warning'
}

/** The identity a reader recognizes: the declaration key, or the row's own name. */
export function mcpDisplayName(entry: McpStatusEntry): string {
  return entry.kind === 'plugin' ? (entry.serverKey ?? entry.name) : entry.name
}

/** The one-line verdict the detail's status band shows. */
export function mcpStateLabel(t: Translate, state: McpStatusEntry['state']): string {
  if (state === 'connected') return t('mcpConnected')
  if (state === 'degraded') return t('mcpDegraded')
  if (state === 'failed') return t('mcpFailed')
  if (state === 'needs-credentials') return t('mcpNeedsCredentials')
  if (state === 'orphaned') return t('mcpOrphaned')
  if (state === 'foreign') return t('mcpForeign')
  // The same word the `已禁用` filter tab uses, so the chip and the tab that
  // finds it agree.
  return t('panelFilterDisabled')
}

/**
 * The live connection's sentence, when a supervisor reports a lost connection.
 *
 * The mount diagnostic explains a server that never came up. This explains the
 * other failure: one that connected, dropped, and is being retried or has
 * stopped. It reads the supervisor's phase rather than the row state, so a row
 * whose tools are still registered says what is actually happening.
 *
 * @param t - the panel's translator.
 * @param entry - the status row, carrying the observation when one exists.
 * @returns the sentence, or undefined when the connection is fine or unobserved.
 */
export function mcpConnectionNote(t: Translate, entry: McpStatusEntry): string | undefined {
  const connection = entry.connection
  if (connection === undefined || connection.phase === 'connected') return undefined
  const lead = connection.phase === 'failed' ? t('mcpReconnectStopped') : t('mcpReconnecting', { attempt: String(connection.attempt), max: String(connection.maxAttempts) })
  return connection.error === undefined ? lead : lead + ' · ' + t('mcpLastError', { error: connection.error })
}

/** The card dot colour: the states the detail dialog also reports. */
export function mcpDotState(state: McpStatusEntry['state']): 'done' | 'warning' | 'error' | 'idle' {
  if (state === 'connected') return 'done'
  if (state === 'failed' || state === 'orphaned') return 'error'
  if (state === 'disabled' || state === 'foreign') return 'idle'
  return 'warning'
}
