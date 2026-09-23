/**
 * The one disclosure row the detail dialogs share.
 *
 * The prototype's detail row is a three-column band — the name, its one-line
 * summary, and a chevron pinned to the trailing edge — inside one bordered
 * group, with the expanded header tinted and its body inset behind a hairline.
 * The platform's `DisclosureRow` is a 24px single-line flow row whose chevron
 * leads the title and only appears on hover, and it paints no hover or expanded
 * background, so those two shapes cannot be reconciled from the outside.
 * @module client/ui/DetailRows
 */
import { createElement as h, type ReactNode } from 'react'
import { IconChevronDownOutlineMedium, IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './detail-rows.module.css'

/** One group of rows; the bordered frame the prototype draws them in. */
export function DetailRows({ children }: { children?: ReactNode }): ReactNode {
  return h('div', { className: css.rows }, children)
}

/** One row: a name, a one-line summary, a trailing chevron, and its content. */
export function DetailRow(props: {
  name: string
  /** Clipped to one line: a long description never grows the row. */
  summary?: string | undefined
  /** A row without content renders as a plain band and takes no chevron. */
  expandable?: boolean | undefined
  open?: boolean | undefined
  onToggle?: (() => void) | undefined
  children?: ReactNode
}): ReactNode {
  const expandable = props.expandable !== false
  const open = props.open === true
  const header = [
    h('span', { key: 'name', className: css.name }, props.name),
    props.summary === undefined || props.summary === '' ? null : h('span', { key: 'summary', className: css.summary }, props.summary),
    expandable ? null : h('span', { key: 'spacer', className: css.chevron })
  ]
  if (!expandable) {
    return h('div', { className: css.group }, h('div', { className: css.row, 'data-static': true }, ...header.slice(0, 2)))
  }
  return h(
    'div',
    { className: css.group },
    h(
      'button',
      {
        type: 'button',
        className: css.row,
        'aria-expanded': open,
        onClick: props.onToggle
      },
      header[0],
      header[1],
      h('span', { className: css.chevron, 'aria-hidden': true }, open ? h(IconChevronDownOutlineMedium) : h(IconChevronRightOutlineMedium))
    ),
    open ? h('div', { className: css.body }, props.children) : null
  )
}
