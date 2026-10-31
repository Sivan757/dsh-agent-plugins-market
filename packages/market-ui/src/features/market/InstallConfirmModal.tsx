/** Pre-install confirmation modal: concise surface counts plus a risk notice. */
import { createElement as h, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SuiteCardData } from '../../api.js'
import type { SuiteSurfaceCounts } from '../../../../market-contracts/src/contracts/market.js'
import type { Translate } from '../../i18n.js'
import type { LocaleKey } from '../../locales.js'
import { PRESET_FACES, WORKSPACE_TAB_META, workspaceKeyOfFace } from '../../workspace/tab-meta.js'
import css from './market.module.css'

export interface InstallConfirmState {
  suite: SuiteCardData
  /** Locked source commit shown in the confirm dialog; undefined for local sources. */
  lockCommit?: string
  /** True when the source is a local working tree (no immutable commit). */
  localSource?: boolean
}

export interface InstallConfirmModalProps {
  t: Translate
  state: InstallConfirmState
  busy: boolean
  onClose: () => void
  onConfirm: () => Promise<boolean>
}

/**
 * Surface count tags shown on the card.
 *
 * The key is the suite's own surface name and the label is the noun the workspace
 * counts that collection in; both come from the shared tab metadata, so a renamed
 * noun reaches this dialog too. The market has no count noun of its own, so it is
 * the one face left out.
 */
const SURFACE_TAGS: Array<{ key: keyof SuiteSurfaceCounts; labelKey: LocaleKey }> = PRESET_FACES.flatMap(face => {
  const key = workspaceKeyOfFace(face)
  const label = key === undefined ? undefined : WORKSPACE_TAB_META[key].surface
  return label === undefined ? [] : [{ key: face as keyof SuiteSurfaceCounts, labelKey: label }]
})

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
        t('installConfirmAction')
      )
    ),
    children: h(
      'div',
      { className: css.installConfirmBody },
      h('div', { className: css.installConfirmSuite }, `${state.suite.sourceId} / ${state.suite.name}`),
      state.suite.version === undefined ? null : h('div', { className: css.installConfirmMeta }, `${t('version')}: v${state.suite.version}`),
      state.lockCommit === undefined ? null : h('div', { className: css.installConfirmCommit }, `${t('installConfirmSource')}: ${state.lockCommit.slice(0, 12)}`),
      state.lockCommit === undefined && state.localSource === true
        ? h('div', { className: css.installConfirmCommit }, `${t('installConfirmSource')}: ${t('installConfirmLocalTree')}`)
        : null,
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
