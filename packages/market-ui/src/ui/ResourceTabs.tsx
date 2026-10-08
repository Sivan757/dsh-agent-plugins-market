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
  /** Placement class for the row; the row policy itself stays in this module. */
  className?: string
}

/** Render one shared tab row. */
export function ResourceTabs<T extends string>({ value, onChange, label, items, className }: ResourceTabsProps<T>): ReactNode {
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
  return h(
    'div',
    { className: className === undefined ? css.row : css.row + ' ' + className },
    h(SegmentedTabs<T>, { className: css.tabs, label, value, onChange, items: [first, ...rest] })
  )
}
