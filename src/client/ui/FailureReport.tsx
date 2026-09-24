/**
 * The one failure report the MCP and LSP detail dialogs share.
 *
 * A failure arrives as a sentence written by the layer that failed, in that
 * layer's own words, and a wrapper sentence such as `initial connection …`
 * names no cause by itself. The report leads with the sentence the classifier
 * picked for the shape it recognized, offers the one recovery action the state
 * has, and keeps the recorded text — with the messages under it — behind a
 * disclosure, so the detail stays available without becoming the headline.
 *
 * @module client/ui/FailureReport
 */
import { useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { IconChevronDownOutlineMedium, IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { FAILURE_GUIDANCE_LABEL, type FailureGuidanceKey } from './failure-guidance.js'
import type { Translate } from '../index.js'
import css from './failure-report.module.css'

export interface FailureReportProps {
  t: Translate
  /** The classified shape; its sentence leads the report. */
  guidance?: FailureGuidanceKey | undefined
  /** Error tone for a failure, informational for a state the panel only notes. */
  tone: 'error' | 'info'
  /** A sentence of the panel's own, for a state the classifier does not name. */
  headline?: string | undefined
  /** The recorded diagnostic lines: the summary first, then the messages under it. */
  detail?: readonly string[] | undefined
  /** One line under the lead, for a caveat the state adds. */
  note?: string | undefined
  /** The one recovery action the state offers. */
  action?: ReactNode
}

export function FailureReport({ t, guidance, tone, headline, detail, note, action }: FailureReportProps): ReactNode {
  const [open, setOpen] = useState(false)
  const lines = (detail ?? []).filter(line => line !== '')
  const lead = headline ?? (guidance === undefined ? undefined : t(FAILURE_GUIDANCE_LABEL[guidance])) ?? lines[0]
  if (lead === undefined && action === undefined) return null
  // The line the lead already states is not repeated in the disclosure.
  const rest = lead === lines[0] ? lines.slice(1) : lines
  return h(
    'section',
    { className: tone === 'error' ? `${css.report} ${css.error}` : `${css.report} ${css.info}` },
    lead === undefined ? null : h('p', { className: css.lead }, lead),
    note === undefined ? null : h('p', { className: css.note }, note),
    action === undefined ? null : h('div', { className: css.action }, action),
    rest.length === 0
      ? null
      : h(
          'div',
          { className: css.detail },
          h(
            'button',
            { type: 'button', className: css.toggle, 'aria-expanded': open, onClick: () => setOpen(value => !value) },
            h('span', { className: css.chevron, 'aria-hidden': true }, open ? h(IconChevronDownOutlineMedium) : h(IconChevronRightOutlineMedium)),
            t('failureDetailToggle')
          ),
          open ? h('div', { className: css.lines }, ...rest.map((line, index) => h('p', { key: index, className: css.line }, line))) : null
        )
  )
}
