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
 * @param now - the clock, so the wait counts down while the panel ticks.
 * @returns the sentence, or undefined when the connection is fine or unobserved.
 */
export function mcpConnectionNote(t: Translate, entry: McpStatusEntry, now = Date.now()): string | undefined {
  const connection = entry.connection
  if (connection === undefined || connection.phase === 'connected') return undefined
  const lead = connection.phase === 'failed' ? t('mcpReconnectStopped') : t('mcpReconnecting', { attempt: String(connection.attempt), max: String(connection.maxAttempts) })
  // The wait belongs in the sentence: "第 2/5 次" says how often, not how long.
  const wait = connection.retryAt === undefined || connection.retryAt <= now ? '' : ' · ' + t('mcpRetryIn', { seconds: String(Math.ceil((connection.retryAt - now) / 1000)) })
  // How long the row has been away answers the other half of "why is this taking so
  // long": the attempt count says how often the host tried, not how long the outage has
  // lasted, and a drop that keeps retrying for a minute reads differently from one that
  // just happened.
  const elapsed = connection.since === undefined ? 0 : now - connection.since
  const since =
    elapsed < 1_000
      ? ''
      : ' · ' + (elapsed >= 90_000 ? t('mcpDownMinutes', { minutes: String(Math.round(elapsed / 60_000)) }) : t('mcpDownSeconds', { seconds: String(Math.round(elapsed / 1000)) }))
  const error = connection.error === undefined ? '' : ' · ' + t('mcpLastError', { error: connection.error })
  return lead + since + wait + error
}

/** The card dot colour: the states the detail dialog also reports. */
export function mcpDotState(state: McpStatusEntry['state']): 'done' | 'warning' | 'error' | 'idle' {
  if (state === 'connected') return 'done'
  if (state === 'failed' || state === 'orphaned') return 'error'
  if (state === 'disabled' || state === 'foreign') return 'idle'
  return 'warning'
}
