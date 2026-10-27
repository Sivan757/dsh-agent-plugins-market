/**
 * The one tab row every market surface uses: the host owns the track, indicator,
 * roving tab stop and walk keys, and this wrapper owns the row policy — equal
 * host columns, ellipsized labels, never a sideways scroll.
 * @module client/ui/ResourceTabs
 */
import { createElement as h, type ReactNode } from 'react'
import { SegmentedTabs, StateDot, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './resource-tabs.module.css'

/** One tab: a localized label, plus the optional support dot the hook rows carry. */
export interface ResourceTabItem<T extends string> {
  value: T
  /** Localized label text; a string, so the shared row can ellipsize it. */
  text: string
  /** Support dot rendered before the label, the hook-event arrangement. */
  dot?: 'done' | 'idle' | 'warning'
  id: string
  panelId: string
}

export interface ResourceTabsProps<T extends string> {
  value: T
  onChange: (value: T) => void
  /** Localized accessible name of the tab list. */
  label: string
  items: readonly ResourceTabItem<T>[]
  /**
   * A control pinned to the row's trailing edge, after the tab list.
   *
   * It renders beside the `role="tablist"` element, never inside it: the host
   * owns the roving tab stop and the walk keys over the tabs, and a second
   * focusable child of the list would join that walk. It never shrinks, so the
   * tabs keep their equal columns and ellipsize instead of the row growing.
   */
  trailing?: ReactNode
  /**
   * Lay the trailing control over the row's right edge instead of beside it.
   *
   * The row competes with the panel below for width, so a control in the flow
   * spends a column the tabs need. Overlaid, it reclaims that column: the tabs
   * get padding on the right for the last label, and the control reads as the
   * row's edge fading out rather than as one more button.
   */
  trailingOverlay?: boolean
  /** Placement class for the row; the row policy itself stays in this module. */
  className?: string
}

/** Render one shared tab row. */
export function ResourceTabs<T extends string>({ value, onChange, label, items, trailing, trailingOverlay = false, className }: ResourceTabsProps<T>): ReactNode {
  const tabs: SegmentedTab<T>[] = items.map(item => ({
    value: item.value,
    // Wrapped here rather than by each caller: one arrangement and one
    // truncation target for every surface, with or without a dot.
    label: h('span', { className: css.label }, item.dot === undefined ? null : h(StateDot, { state: item.dot }), h('span', { className: css.labelText }, item.text)),
    id: item.id,
    panelId: item.panelId
  }))
  // The host demands a non-empty tuple; an empty row renders nothing.
  const [first, ...rest] = tabs
  if (first === undefined) return null
  // The overlay variant owns its own row class, so the positioning and the tab
  // padding stay here rather than in each caller's stylesheet.
  const rowClass = className === undefined ? css.row : css.row + ' ' + className
  return h(
    'div',
    { className: trailingOverlay ? rowClass + ' ' + css.rowOverlay : rowClass },
    h(SegmentedTabs<T>, {
      className: trailingOverlay ? css.tabs + ' ' + css.tabsOverlay : css.tabs,
      label,
      value,
      onChange,
      items: [first, ...rest]
    }),
    trailing === undefined ? null : h('div', { className: trailingOverlay ? css.trailing + ' ' + css.trailingOverlay : css.trailing }, trailing)
  )
}
