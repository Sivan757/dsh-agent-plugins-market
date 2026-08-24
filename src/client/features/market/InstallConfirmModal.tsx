/** Pre-install confirmation modal: concise surface counts plus a risk notice. */
import { createElement as h, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SuiteCardData } from '../../api.js'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

export interface InstallConfirmState {
  suite: SuiteCardData
}

export interface InstallConfirmModalProps {
  t: Translate
  state: InstallConfirmState
  busy: boolean
  onClose: () => void
  onConfirm: () => Promise<boolean>
}

/** Surface count tags shown on the card; keys mirror SuiteCard's tag list. */
const SURFACE_TAGS: Array<{ key: 'skills' | 'mcp' | 'hooks' | 'commands' | 'agents'; labelKey: 'surfaceSkills' | 'surfaceMcp' | 'surfaceHooks' | 'surfaceCommands' | 'surfaceAgents' }> = [
  { key: 'skills', labelKey: 'surfaceSkills' },
  { key: 'mcp', labelKey: 'surfaceMcp' },
  { key: 'hooks', labelKey: 'surfaceHooks' },
  { key: 'commands', labelKey: 'surfaceCommands' },
  { key: 'agents', labelKey: 'surfaceAgents' }
]

export function InstallConfirmModal(props: InstallConfirmModalProps): ReactNode {
  const { t, state, busy } = props
  const surfaces = state.suite.surfaces
  const tags = SURFACE_TAGS.filter(tag => surfaces[tag.key] > 0)
  const executable = surfaces.mcp > 0 || surfaces.hooks > 0

  return h(Modal, {
    open: true,
    onClose: props.onClose,
    title: t('installConfirmTitle'),
    description: t('installConfirmDesc'),
    closeLabel: t('cancel'),
    className: css.editorDialog,
    footer: h(
      'div',
      { className: css.modalFooter },
      h(Button, { variant: 'ghost', disabled: busy, onClick: props.onClose }, t('cancel')),
      h(
        Button,
        {
          variant: 'primary',
          disabled: busy,
          onClick: () => {
            void props.onConfirm()
          }
        },
        t('installAndEnable')
      )
    ),
    children: h(
      'div',
      { className: css.installConfirmBody },
      h('div', { className: css.installConfirmSuite }, `${state.suite.sourceId} / ${state.suite.name}`),
      state.suite.version === undefined ? null : h('div', { className: css.installConfirmMeta }, `${t('version')}: v${state.suite.version}`),
      tags.length === 0
        ? h('div', { className: css.installConfirmMeta }, t('installConfirmNoSurfaces'))
        : h(
            'div',
            { className: css.installConfirmTags },
            tags.map(tag => h('span', { key: tag.key, className: css.tag }, `${t(tag.labelKey)} ${surfaces[tag.key]}`))
          ),
      executable ? h('div', { className: css.installConfirmWarn }, t('installConfirmExecutable')) : null
    )
  })
}
