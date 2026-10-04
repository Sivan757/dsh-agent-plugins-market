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
import { hintProps, hoverHint } from './hover-hint.js'
import css from './detail-rows.module.css'
import panelCss from './panel.module.css'

/**
 * One group of rows; the bordered frame the prototype draws them in.
 *
 * A group that needs a name carries it inside that frame: a label floating
 * above the border would read as the heading of whatever bordered group comes
 * next, which is not what a label is for.
 */
export function DetailRows({
  label,
  summary,
  open,
  onToggle,
  children
}: {
  label?: string | undefined
  /** One line beside the name, e.g. how many rows the group holds. */
  summary?: string | undefined
  /** Whether the group's rows are shown; only read with `onToggle`. */
  open?: boolean | undefined
  /** Makes the name band the control that collapses and reveals the rows. */
  onToggle?: (() => void) | undefined
  children?: ReactNode
}): ReactNode {
  const shown = open !== false
  // Both bands clip to one line, so each carries its full text as a hint — the
  // host tooltip, which shows on hover with no delay.
  const head = (interactive: boolean): ReactNode => {
    const name = label === undefined ? null : hoverHint(label, h('span', hintProps({ className: css.name }), label))
    const note = summary === undefined || summary === '' ? null : hoverHint(summary, h('span', hintProps({ className: css.summary }), summary))
    if (!interactive) return h('div', { className: css.row }, name, note, h('span', { className: css.chevron }))
    return h(
      'button',
      { type: 'button', className: css.row, 'aria-expanded': shown, onClick: onToggle },
      name,
      note,
      h('span', { className: css.chevron, 'aria-hidden': true }, shown ? h(IconChevronDownOutlineMedium) : h(IconChevronRightOutlineMedium))
    )
  }
  return h(
    'div',
    { className: css.rows },
    // The name is a row of the frame it labels: the same band a row shows, so a
    // folded group and a folded disclosure are the same shape, and an opened
    // one takes the same soft grey.
    label === undefined || label === '' ? null : h('div', { className: css.group }, head(onToggle !== undefined)),
    onToggle !== undefined && !shown ? null : children
  )
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
    hoverHint(props.name, h('span', hintProps({ key: 'name', className: css.name }), props.name)),
    props.summary === undefined || props.summary === '' ? null : hoverHint(props.summary, h('span', hintProps({ key: 'summary', className: css.summary }), props.summary)),
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

/** One label/value pair in a detail dialog's overview grid; `key` props a row built in a loop. */
export function kvCell(label: string, value: string, mono = false, key?: string): ReactNode {
  return h('div', key === undefined ? null : { key }, h('dt', { className: panelCss.kvKey }, label), hoverHint(value, h('dd', hintProps({ className: mono ? `${panelCss.kvValue} ${panelCss.kvValueMono}` : panelCss.kvValue }), value)))
}
