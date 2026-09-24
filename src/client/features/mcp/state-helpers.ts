import { createElement as h, type ReactNode } from 'react'
import { type Translate } from '../../index.js'
import type { McpStatusEntry } from '../../api.js'
import panelCss from '../../ui/panel.module.css'

export function mcpTagTone(state: McpStatusEntry['state']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (state === 'connected') return 'success'
  if (state === 'failed' || state === 'orphaned') return 'danger'
  if (state === 'disabled' || state === 'foreign') return 'neutral'
  return 'warning'
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

/** One label/value pair in a detail dialog's overview grid. */
export function kvCell(label: string, value: string, mono = false): ReactNode {
  return h('div', null, h('dt', { className: panelCss.kvKey }, label), h('dd', { className: mono ? `${panelCss.kvValue} ${panelCss.kvValueMono}` : panelCss.kvValue, title: value }, value))
}

/** The card dot colour: the states the detail dialog also reports. */
export function mcpDotState(state: McpStatusEntry['state']): 'done' | 'warning' | 'error' | 'idle' {
  if (state === 'connected') return 'done'
  if (state === 'failed' || state === 'orphaned') return 'error'
  if (state === 'disabled' || state === 'foreign') return 'idle'
  return 'warning'
}

/** The failure report's tone: only the states the card marks as errors shout. */
export function mcpReportTone(state: McpStatusEntry['state']): 'error' | 'info' {
  return state === 'failed' || state === 'orphaned' ? 'error' : 'info'
}

/**
 * One inventory card: the server name with its state tag on the identity row
 * and the enable switch on its trailing edge; the endpoint on the body row;
 * tool count and transport on the source row. The reason text, the state
 * label's long form, and the remaining actions (retry, reauthorize,
 * configuration) live in the detail dialog, so a wall of failing cards stays
 * scannable.
 */
