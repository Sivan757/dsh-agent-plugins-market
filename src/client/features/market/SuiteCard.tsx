/** A suite card in the market grid/list. */
import { createElement as h, type ReactElement, type ReactNode } from 'react'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SuiteCardData } from '../../api.js'
import type { Translate } from '../../index.js'
import { ToggleSwitch } from '../../ui/ToggleSwitch.js'
import css from '../../market.module.css'

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
  const tags: Array<[string, number]> = (
    [
      [t('surfaceSkills'), suite.surfaces.skills],
      [t('surfaceMcp'), suite.surfaces.mcp],
      [t('surfaceHooks'), suite.surfaces.hooks],
      [t('surfaceCommands'), suite.surfaces.commands],
      [t('surfaceAgents'), suite.surfaces.agents],
      [t('surfaceLsp'), suite.surfaces.lsp]
    ] as Array<[string, number]>
  ).filter(([, count]) => count > 0)
  const layoutLabel =
    suite.layout === 'agent-plugin-v1'
      ? t('layoutV1')
      : suite.layout === 'claude-code'
        ? t('layoutCC')
        : suite.layout === 'codex'
          ? t('layoutCodex')
          : suite.layout === 'universal'
            ? t('layoutUniversal')
            : suite.layout === 'cursor'
              ? t('layoutCursor')
              : suite.layout === 'kimi'
                ? t('layoutKimi')
                : suite.layout === 'remote'
                  ? t('layoutRemote')
                  : suite.layout === 'project-native'
                    ? t('layoutProjectNative')
                    : t('layoutSkills')
  const isRemote = suite.remoteUrl !== undefined
  const stop = (callback: () => void) => (event: { stopPropagation(): void }) => {
    event.stopPropagation()
    callback()
  }
  return h(
    'article',
    { className: css.card, onClick: props.onOpen },
    h(
      'div',
      { className: css.cardTop },
      h(
        'div',
        { className: css.cardTitle },
        h('span', { className: css.cardName }, suite.name),
        suite.version === undefined ? null : h('span', { className: css.version }, `v${suite.version}`)
      ),
      h(
        'div',
        { className: css.cardActions },
        suite.installed
          ? h(ToggleSwitch, {
              on: suite.enabled,
              disabled: busy,
              title: suite.enabled ? t('disable') : t('enable'),
              onChange: props.onToggle
            })
          : isRemote
            ? h(
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
            : h(
                Button,
                {
                  variant: 'primary',
                  size: 'sm',
                  disabled: busy,
                  onClick: stop(props.onInstall)
                },
                t('install')
              ),
        suite.installed ? h(Button, { variant: 'ghost', size: 'sm', title: t('refresh'), disabled: busy, onClick: stop(props.onRefresh) }, '↻') : null,
        suite.installed ? h(Button, { variant: 'ghost', size: 'sm', title: t('uninstall'), disabled: busy, onClick: stop(props.onUninstall) }, '🗑') : null
      )
    ),
    h('p', { className: css.desc }, suite.description ?? ''),
    h(
      'div',
      { className: css.meta },
      h('span', { className: css.src }, `${suite.sourceId} · ${isRemote ? t('remoteRef') : suite.dimension === 'user' ? t('dimensionUser') : t('dimensionProject')}`),
      h('span', { className: css.tag }, layoutLabel),
      suite.installed ? h('span', { className: suite.enabled ? css.okState : css.tag }, suite.enabled ? `✓ ${t('installedBadge')}` : t('installedBadge')) : null,
      ...tags.map(([label, count]) => h('span', { key: label, className: css.tag }, `${label} ${count}`)),
      suite.errors.length === 0
        ? null
        : h(Tooltip, {
            label: suite.errors.slice(0, 8).join(t('sourceErrorSeparator')),
            children: h('span', { className: css.warnLine }, `⚠ ${t('errors')} ${suite.errors.length}`) as unknown as ReactElement
          }),
      (suite.mcpErrors?.length ?? 0) === 0
        ? null
        : h(Tooltip, {
            label: suite.mcpErrors!.slice(0, 8).join(t('sourceErrorSeparator')),
            children: h('span', { className: css.warnLine }, `⚠ ${t('mcpSection')} ${suite.mcpErrors!.length}`) as unknown as ReactElement
          })
    )
  )
}
