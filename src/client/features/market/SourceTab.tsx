/** A source tab with trailing edit and delete controls. */
import { createElement as h, type ReactNode } from 'react'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

export interface SourceTabProps {
  t: Translate
  active?: boolean
  label: string
  /** Hover hint for the tab (e.g. scan diagnostics); undefined hides it. */
  title?: string
  onSelect: () => void
  onDelete?: () => void
  onEdit?: () => void
}

/** A source chip with a trailing delete control (deletion confirms at the section level). */
export function SourceTab(props: SourceTabProps): ReactNode {
  const { t, active = false, label, title, onSelect, onDelete, onEdit } = props
  return h(
    'div',
    { className: active ? css.srcTabOn : css.srcTab, title },
    h('button', { type: 'button', className: css.srcTabMain, onClick: onSelect }, label),
    onEdit === undefined
      ? null
      : h(
          'button',
          {
            type: 'button',
            className: css.srcTabEdit,
            title: t('editSource'),
            onClick: (event: { stopPropagation(): void }) => {
              event.stopPropagation()
              onEdit()
            }
          },
          '✎'
        ),
    onDelete === undefined
      ? null
      : h(
          'button',
          {
            type: 'button',
            className: css.srcTabDel,
            title: t('remove'),
            onClick: (event: { stopPropagation(): void }) => {
              event.stopPropagation()
              onDelete()
            }
          },
          '×'
        )
  )
}
