/** A source tab with trailing edit and delete controls. */
import { createElement as h, type ReactNode } from 'react'
import type { Translate } from '../i18n.js'
import css from './source-strip.module.css'

export interface SourceTabProps {
  t: Translate
  active?: boolean
  label: string
  /** Hover hint for the tab (e.g. scan diagnostics); undefined hides it. */
  title?: string
  onSelect: () => void
  onDelete?: () => void
  onEdit?: () => void
  /** Accessible name for the delete control; callers whose domain names
   * deletion differently pass their own (the market keeps the shared
   * remove label). */
  deleteTitle?: string
}

/** A source chip with a trailing delete control (deletion confirms at the section level). */
export function SourceTab(props: SourceTabProps): ReactNode {
  const { t, active = false, label, title, onSelect, onDelete, onEdit, deleteTitle } = props
  return h(
    'div',
    {
      className: active ? css.srcTabOn : css.srcTab,
      title,
      // The whole chip selects the source, not only the run of characters
      // that spell its name: the chip's own padding is part of the target,
      // and the trailing controls keep their clicks to themselves.
      onClick: onSelect
    },
    h(
      'button',
      {
        type: 'button',
        className: css.srcTabMain,
        // The name stays a real control for the keyboard and for assistive
        // technology. Its click stops here so the chip's own handler does
        // not select the source a second time.
        onClick: (event: { stopPropagation(): void }) => {
          event.stopPropagation()
          onSelect()
        }
      },
      label
    ),
    onEdit === undefined && onDelete === undefined
      ? null
      : h(
          'span',
          { className: css.srcTabControls },
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
                  title: deleteTitle ?? t('remove'),
                  ...(deleteTitle === undefined ? {} : { 'aria-label': deleteTitle }),
                  onClick: (event: { stopPropagation(): void }) => {
                    event.stopPropagation()
                    onDelete()
                  }
                },
                '×'
              )
        )
  )
}
