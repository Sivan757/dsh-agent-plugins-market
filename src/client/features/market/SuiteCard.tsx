/**
 * A suite card. One anatomy for every surface: identity row (name, version,
 * provenance tag) with the action cluster on its trailing edge, a full-width
 * description, and a source row carrying the counts.
 */
import { createElement as h, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Button, IconRefreshOutline16, IconTrashOutline16, Switch, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SuiteCardData } from '../../api.js'
import type { Translate } from '../../index.js'
import rc from '../../ui/resource-card.module.css'
import { ResourceCard } from '../../ui/ResourceCard.js'

/** Surface counts render as `label <number>`, separated by a middot. */
function countList(t: Translate, suite: SuiteCardData): Array<[string, number]> {
  return (
    [
      [t('surfaceSkills'), suite.surfaces.skills],
      [t('surfaceMcp'), suite.surfaces.mcp],
      [t('surfaceHooks'), suite.surfaces.hooks],
      [t('surfaceCommands'), suite.surfaces.commands],
      [t('surfaceAgents'), suite.surfaces.agents],
      [t('surfaceLsp'), suite.surfaces.lsp]
    ] as Array<[string, number]>
  ).filter(([, count]) => count > 0)
}

/**
 * A warning chip. `Tooltip` clones its child and chains its own hover/focus
 * handlers onto it, so the anchor is a plain span with an explicit prop type.
 */
function warnAnchor(text: string): ReactElement<HTMLAttributes<HTMLSpanElement>> {
  const props: HTMLAttributes<HTMLSpanElement> = { className: rc.warnWrap }
  return h('span', props, h(Tag, { tone: 'warning' }, text))
}

export interface SuiteCardProps {
  t: Translate
  suite: SuiteCardData
  busy: boolean
  onOpen: () => void
  onInstall: () => void
  onAddSource: () => void
  onToggle: () => void
  onRefresh: () => void
  onUninstall: () => void
}

export function SuiteCard(props: SuiteCardProps): ReactNode {
  const { t, suite, busy } = props
  const counts = countList(t, suite)
  const isRemote = suite.remoteUrl !== undefined
  const mcpErrors = suite.mcpErrors ?? []
  const provenance = isRemote ? t('remoteRef') : suite.dimension === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')
  const stop = (callback: () => void) => (event: { stopPropagation(): void }) => {
    event.stopPropagation()
    callback()
  }
  // The card itself is the click target, so every control inside it has to keep
  // its own click from reaching the card.
  const toolbarStop = (event: { stopPropagation(): void }): void => event.stopPropagation()

  const actions = suite.installed
    ? [
        h(
          'button',
          {
            key: 'refresh',
            type: 'button',
            className: `${rc.iconBtn} ${rc.revealOnHover}`,
            title: t('refresh'),
            'aria-label': t('refresh'),
            disabled: busy,
            onClick: stop(props.onRefresh)
          },
          h(IconRefreshOutline16)
        ),
        h(
          'button',
          {
            key: 'uninstall',
            type: 'button',
            className: `${rc.iconBtn} ${rc.iconBtnDanger} ${rc.revealOnHover}`,
            title: t('uninstall'),
            'aria-label': t('uninstall'),
            disabled: busy,
            onClick: stop(props.onUninstall)
          },
          h(IconTrashOutline16)
        ),
        // The enable switch reads last, at the cluster's trailing edge.
        h(
          'span',
          { key: 'toggle', className: rc.switchWrap, onClick: toolbarStop },
          h(Switch, {
            checked: suite.enabled,
            disabled: busy,
            label: suite.enabled ? t('disable') : t('enable'),
            title: suite.enabled ? t('disable') : t('enable'),
            onChange: props.onToggle
          })
        )
      ]
    : [
        isRemote
          ? h(
              'span',
              { key: 'addSource', className: `${rc.switchWrap} ${rc.revealOnHover}` },
              h(
                Button,
                {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  title: suite.remoteUrl,
                  onClick: stop(props.onAddSource)
                },
                t('addSource')
              )
            )
          : h(
              'span',
              { key: 'install', className: `${rc.switchWrap} ${rc.revealOnHover}` },
              h(
                Button,
                {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  onClick: stop(props.onInstall)
                },
                t('install')
              )
            )
      ]

  return h(
    ResourceCard,
    { state: suite.installed && suite.enabled ? 'active' : 'disabled', surface: 'market', onClick: props.onOpen },
    h(
      'div',
      { className: rc.rowId },
      h('span', { className: rc.name }, suite.name),
      suite.version === undefined ? null : h('span', { className: rc.version }, `v${suite.version}`),
      h(Tag, { tone: 'neutral' }, provenance)
    ),
    h('div', { className: rc.rowActions }, ...actions),
    h('p', { className: `${rc.rowBody} ${rc.desc}` }, suite.description ?? ''),
    h(
      'div',
      { className: rc.rowFoot },
      h('span', { className: rc.provenance, title: suite.sourceId }, suite.sourceId),
      ...counts.flatMap(([label, count]) => [
        h('span', { key: `sep-${label}`, className: rc.separator }, '·'),
        h('span', { key: label, className: rc.count }, label, ' ', h('span', { className: rc.countValue }, String(count)))
      ]),
      suite.errors.length === 0
        ? null
        : h('span', { key: 'errors', className: rc.separator }, '·'),
      suite.errors.length === 0
        ? null
        : h(Tooltip, { label: suite.errors.slice(0, 8).join(t('sourceErrorSeparator')), children: warnAnchor(`⚠ ${t('errors')} ${suite.errors.length}`) }),
      mcpErrors.length === 0 ? null : h('span', { key: 'mcpSep', className: rc.separator }, '·'),
      mcpErrors.length === 0
        ? null
        : h(Tooltip, { label: mcpErrors.slice(0, 8).join(t('sourceErrorSeparator')), children: warnAnchor(`⚠ ${t('mcpSection')} ${mcpErrors.length}`) })
    )
  )
}
