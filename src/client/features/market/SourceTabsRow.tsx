/**
 * The source chip strip: an equal-width pill grid that folds to two rows and
 * expands in place on hover or keyboard focus.
 *
 * Chips keep the header's original `auto-fill` grid, so every pill in a row is
 * the same width and long ids ellipsize instead of stretching a column. While
 * folded the grid is lifted out of the flow at a fixed two-row height with a
 * bottom fade hinting at the rest; hovering or focusing it grows the same grid
 * as an overlay, so the card grid below never moves. The selected source is
 * ordered second, which keeps its edit and delete controls inside the fold.
 */
import { createElement as h, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SourceTab } from './SourceTab.js'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

/** Rows kept visible while folded. */
const COLLAPSED_ROWS = 2
/** One chip row: the 24px pill plus the 4px grid gap that follows it. */
const CHIP_ROW_HEIGHT = 28
/** Folded content height: two rows without the trailing gap. */
const COLLAPSED_CONTENT_HEIGHT = CHIP_ROW_HEIGHT * COLLAPSED_ROWS - 4
/** Overlay padding around the grid; `scrollHeight` includes it. */
const OVERLAY_PADDING = 6
/** `scrollHeight` that still fits the folded grid — taller means it can expand. */
const COLLAPSED_SCROLL_HEIGHT = COLLAPSED_CONTENT_HEIGHT + OVERLAY_PADDING * 2

/** One chip in the source strip. */
export interface SourceTabItem {
  id: string
  /** Visible chip text: `id · kind count`. */
  label: string
  /** Hover hint (scan diagnostics); undefined renders no title. */
  title?: string
  /** The selected source exposes its edit control. */
  editable?: boolean
  /** Source chips can be removed; the leading `全部` chip cannot. */
  deletable?: boolean
}

export interface SourceTabsRowProps {
  t: Translate
  /** `全部` first, the selected source second, the remaining sources after it. */
  items: readonly SourceTabItem[]
  activeId: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
}

/**
 * Render the source chip grid, folded when it needs more than two rows.
 *
 * @param props - Chips in display order, the active scope, and chip actions.
 * @returns An equal-width pill grid that unfolds as an overlay.
 */
export function SourceTabsRow(props: SourceTabsRowProps): ReactNode {
  const { t, items, activeId, onSelect, onDelete, onEdit } = props
  const gridRef = useRef<HTMLDivElement>(null)
  const [folded, setFolded] = useState(false)

  const measure = useCallback(() => {
    const grid = gridRef.current
    if (grid === null) return
    // scrollHeight reports the full content height even while the fold clips
    // it, and it does not change when the overlay expands on hover — so the
    // fold state stays stable while the pointer is inside the strip.
    setFolded(grid.scrollHeight > COLLAPSED_SCROLL_HEIGHT)
  }, [])

  useLayoutEffect(() => {
    measure()
    const grid = gridRef.current
    if (grid === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(grid)
    return () => observer.disconnect()
  }, [measure, items])

  return h(
    'div',
    { className: folded ? `${css.sourceTabsBox} ${css.sourceTabsBoxFold}` : css.sourceTabsBox },
    h(
      'div',
      { ref: gridRef, className: css.sourceTabsRow },
      ...items.map(item =>
        h(SourceTab, {
          key: item.id,
          t,
          active: item.id === activeId,
          label: item.label,
          title: item.title,
          onSelect: () => onSelect(item.id),
          onDelete: item.deletable === true ? () => onDelete(item.id) : undefined,
          onEdit: item.editable === true ? () => onEdit(item.id) : undefined
        })
      )
    )
  )
}
