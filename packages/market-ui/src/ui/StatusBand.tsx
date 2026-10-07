/**
 * The one status band the MCP and LSP service details open with.
 *
 * The band is the dialog's only state container. Its first line holds the state
 * dot, the state tags, and the one recovery action the state offers on the
 * trailing edge; under it come what the last operation did, the sentence the
 * failure classifier picked, the recorded diagnostic behind a disclosure, and
 * the endpoint or command the service runs.
 *
 * The 3px leading edge carries the state with the same mapping the inventory
 * card uses, while the fill stays the platform's soft neutral one: a healthy
 * service reads calm, and a failure is marked by its edge, never by making the
 * prose or the whole block take the error colour.
 *
 * @module client/ui/StatusBand
 */
import { useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { DisclosureRow, IconChevronRightOutlineMedium, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { FAILURE_GUIDANCE_LABEL, type FailureGuidanceKey } from './failure-guidance.js'
import type { ResourceState } from './ResourceCard.js'
import type { Translate } from '../i18n.js'
import css from './status-band.module.css'

/** The leading edge of a status band, one tone per inventory-card state. */
export type BandTone = 'success' | 'warn' | 'error' | 'neutral'

/**
 * The band edge for a card state, so a service's card and its detail band can
 * never disagree about what colour the state is.
 */
export function bandTone(state: ResourceState): BandTone {
  if (state === 'active') return 'success'
  if (state === 'error') return 'error'
  if (state === 'warning') return 'warn'
  return 'neutral'
}

export interface StatusBandProps {
  t: Translate
  /** The state dot, from the same card-state mapping as {@link BandTone}. */
  dot: 'done' | 'warning' | 'ongoing' | 'error' | 'idle'
  /** The edge tone of the state this band reports. */
  tone: BandTone
  /** The state tags on the band's first line. */
  labels: ReactNode
  /** The one recovery action this state offers, on the first line's trailing edge. */
  action?: ReactNode
  /** What the last operation did; it never restates the reason below it. */
  echo?: { readonly error: boolean; readonly text: string } | undefined
  /** The classified failure shape; its sentence leads the reason line. */
  guidance?: FailureGuidanceKey | undefined
  /** The recorded diagnostic: disclosed when classified, shown as-is when not. */
  reason?: string | undefined
  /** The messages under the failure's cause chain; disclosed alongside the reason. */
  causes?: readonly string[] | undefined
  /** The endpoint or command the service runs, in mono. */
  mono?: string | undefined
}

export function StatusBand({ t, dot, tone, labels, action, echo, guidance, reason, causes, mono }: StatusBandProps): ReactNode {
  const [open, setOpen] = useState(false)
  const lead = guidance === undefined ? reason : t(FAILURE_GUIDANCE_LABEL[guidance])
  // A classified failure keeps the words another layer chose behind the
  // disclosure; a sentence the classifier cannot place is already the original
  // text, so it has nothing left to hide and renders no disclosure at all.
  const diagnostic = guidance === undefined ? [] : [reason, ...(causes ?? [])].filter((line): line is string => line !== undefined && line !== '')
  return h(
    'section',
    { className: css.band, 'data-band-tone': tone, 'data-status-band': true },
    h(
      'div',
      { className: css.top },
      h(StateDot, { state: dot }),
      h('div', { className: css.labels }, labels),
      action === undefined ? null : h('div', { className: css.actions }, action)
    ),
    echo === undefined ? null : h('p', { className: echo.error ? css.echo : `${css.echo} ${css.echoSuccess}`, role: echo.error ? 'alert' : 'status' }, echo.text),
    lead === undefined ? null : h('p', { className: css.reason }, lead),
    diagnostic.length === 0
      ? null
      : h(
          DisclosureRow,
          {
            icon: h(IconChevronRightOutlineMedium),
            title: t('failureDetailToggle'),
            open,
            expandable: true,
            onToggle: () => setOpen(value => !value),
            expandOnRowClick: true,
            previewChevron: false
          },
          h('div', { className: css.diagnostic }, ...diagnostic.map((line, index) => h('p', { key: index, className: css.diagnosticLine }, line)))
        ),
    mono === undefined ? null : h('p', { className: css.mono }, mono)
  )
}
