/**
 * The workspace tab row's trailing control: the stowed-tabs menu and the modal
 * that manages it.
 *
 * The trigger, the menu and the dialog are host primitives — `Menu`, `Modal`,
 * `Checkbox`, `Button` and `Tooltip` — so this module owns the arrangement and
 * the copy only. It is a presentation component: the stow list, the active tab
 * and the write live in the workspace, which is what keeps the row and the panel
 * in agreement while a write is in flight.
 * @module client/workspace/TabStowControl
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Checkbox, IconEllipsisOutlineMedium, IconSettingsOutlineMedium, Menu, Modal, Tooltip, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { PINNED_TAB_KEY } from '../../../market-contracts/src/contracts/tab-layout.js'
import type { Translate } from '../i18n.js'
import css from './workspace.module.css'

/** One row of the manager: the tab it controls and its localized label. */
export interface StowableTab {
  /** The tab key, which is also the wire value. */
  key: string
  /** Localized label, the same text the tab renders. */
  label: string
}

export interface TabStowControlProps {
  t: Translate
  /** Every tab in row order. */
  tabs: readonly StowableTab[]
  /** The tabs the row currently renders, in order: the range reordering acts on. */
  visible: readonly string[]
  /** The stowed keys, already resolved. */
  hidden: readonly string[]
  /** Whether a write is in flight; the manager refuses a second one. */
  busy: boolean
  /** A failed load or write, reported here rather than over the workspace. */
  error: string | undefined
  /** Select one tab: a stowed row's jump, or the tab a modal change stows away. */
  onSelect: (tab: string) => void
  /** Replace the stow list. The workspace applies it optimistically and persists it. */
  onStow: (next: readonly string[]) => void
  /** Move a tab within the rendered row. The workspace persists the new order. */
  onReorder: (from: number, to: number) => void
}

/** The id the menu gives its manage row; tab keys are the other row ids. */
const MANAGE_ID = '\u0000manage'

/** One trailing trigger, its stowed-tabs menu, and the tab manager dialog. */
export function TabStowControl({ t, tabs, visible, hidden, busy, error, onSelect, onStow, onReorder }: TabStowControlProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const stowed = tabs.filter(tab => hidden.includes(tab.key))
  const shownNow = tabs.filter(tab => !hidden.includes(tab.key))
  const count = stowed.length

  // The stowed group is first and only exists when something is stowed. The
  // manage row always renders, so the entry point never disappears.
  const items: MenuEntry[] = [
    ...(count === 0 ? [] : [{ type: 'label' as const, id: 'stowed-heading', text: t('tabMenuStowedGroup') }, ...stowed.map(tab => ({ id: tab.key, label: tab.label }))]),
    ...(count === 0 ? [] : [{ type: 'separator' as const, id: 'stowed-separator' }]),
    { id: MANAGE_ID, label: t('tabMenuManage'), icon: h(IconSettingsOutlineMedium) }
  ]

  return h(
    'span',
    { className: css.tabStow },
    h(Menu, {
      open: menuOpen,
      onClose: () => setMenuOpen(false),
      // The row clips its own overflow, so the list must escape it.
      portal: true,
      align: 'end',
      dense: true,
      items,
      onSelect: id => {
        if (id === MANAGE_ID) {
          setMenuOpen(false)
          setManageOpen(true)
          return
        }
        onSelect(id)
        setMenuOpen(false)
      },
      anchor: h(Tooltip, {
        label: count === 0 ? t('tabMenuTrigger') : t('tabMenuTrigger') + ' · ' + t('tabMenuStowedCount', { count }),
        side: 'top',
        children: h(
          'span',
          null,
          h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              className: css.tabStowTrigger,
              'aria-label': t('tabMenuTrigger'),
              'aria-haspopup': 'menu',
              'aria-expanded': menuOpen,
              onClick: () => setMenuOpen(value => !value)
            },
            h(IconEllipsisOutlineMedium),
            count === 0 ? null : h('span', { className: css.tabStowBadge, 'aria-hidden': true }, String(count))
          )
        )
      })
    }),
    // One dialog for every change, so the row and the modal never disagree about
    // which control is the last visible one.
    h(
      Modal,
      {
        open: manageOpen,
        onClose: () => setManageOpen(false),
        title: t('tabManageTitle'),
        description: t('tabManageDesc'),
        closeLabel: t('tabManageDone'),
        footer: h(
          'span',
          { className: css.tabManageFooter },
          h(Button, { variant: 'outline', size: 'sm', disabled: busy || count === 0, onClick: () => onStow([]) }, t('tabManageShowAll')),
          h(Button, { variant: 'primary', size: 'sm', onClick: () => setManageOpen(false) }, t('tabManageDone'))
        )
      },
      h(
        'div',
        { className: css.tabManageList },
        ...tabs.map(tab => {
          const visibleNow = !hidden.includes(tab.key)
          // The control that would empty the row is the one that stows the last
          // visible tab, so that is the control that is disabled.
          const lastVisible = visibleNow && shownNow.length === 1
          // Reordering acts on the rendered row, so a stowed tab has no arrows:
          // its position comes back with it, and an invisible target would make
          // the buttons lie about where the tab lands.
          const at = visible.indexOf(tab.key)
          // The pinned tab is the row's first column in every layout, so it has
          // nothing to move between and the pair would only be dead buttons.
          const movable = visibleNow && tab.key !== PINNED_TAB_KEY
          const canMoveLeft = movable && at > 1
          const canMoveRight = movable && at >= 0 && at < visible.length - 1
          return h(
            'div',
            { key: tab.key, className: css.tabManageRow, 'data-tab-stow-row': tab.key },
            h(Checkbox, {
              checked: visibleNow,
              onChange: next => (next ? onStow(hidden.filter(key => key !== tab.key)) : onStow([...hidden, tab.key])),
              label: tab.label,
              disabled: busy || lastVisible,
              ...(lastVisible ? { title: t('tabManageLastVisibleHint') } : {})
            }),
            movable
              ? h(
                  'span',
                  { className: css.tabManageMove },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: css.tabManageMoveButton,
                      'aria-label': t('tabManageMoveLeft', { tab: tab.label }),
                      disabled: busy || !canMoveLeft,
                      onClick: () => onReorder(at, at - 1)
                    },
                    '\u2190'
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: css.tabManageMoveButton,
                      'aria-label': t('tabManageMoveRight', { tab: tab.label }),
                      disabled: busy || !canMoveRight,
                      onClick: () => onReorder(at, at + 1)
                    },
                    '\u2192'
                  )
                )
              : null,
            h('span', { className: css.tabManageHint }, lastVisible ? t('tabManageLastVisibleHint') : visibleNow ? t('tabManageRowHint') : t('tabManageRowStowedHint'))
          )
        }),
        error === undefined ? null : h('p', { className: css.tabManageError, role: 'status' }, error)
      )
    )
  )
}
