/**
 * The source chip strip: an equal-width pill grid that folds to two rows and
 * expands in place on hover or keyboard focus.
 *
 * Chips keep the header's original `auto-fill` grid, so every pill in a row is
 * the same width and long ids ellipsize instead of stretching a column. While
 * folded the grid is lifted out of the flow at a fixed two-row height with a
 * bottom fade hinting at the rest; hovering or focusing it grows the same grid
 * as an overlay, so the card grid below never moves. Picking a source folds the
 * strip again at once. Chips keep their id order — the selected source is not
 * moved to the front.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { SourceTab } from './SourceTab.js'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

/** Rows kept visible while folded. */
const COLLAPSED_ROWS = 2
/** One chip row: the 24px pill plus the 4px grid gap that follows it. */
const CHIP_ROW_HEIGHT = 28
/** Folded content height: two rows without the trailing gap. */
const COLLAPSED_CONTENT_HEIGHT = CHIP_ROW_HEIGHT * COLLAPSED_ROWS - 4
/** Overlay padding above the grid; `scrollHeight` includes it. */
const OVERLAY_PADDING = 6
/** `scrollHeight` that still fits the folded grid — taller means it can expand. */
const COLLAPSED_SCROLL_HEIGHT = COLLAPSED_CONTENT_HEIGHT + OVERLAY_PADDING
/**
 * How long the pointer must stay outside the strip before hover expansion is
 * re-armed. Folding after a pick can push the pointer out of the box
 * mid-gesture; without this grace the very next pointer move reopens the strip.
 */
const LEAVE_GRACE_MS = 300

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
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [folded, setFolded] = useState(false)
  // Picking a source folds the strip immediately, even though the pointer is
  // still inside it; leaving the strip (or focus) re-arms the hover expansion.
  const [picked, setPicked] = useState(false)

  const cancelLeave = useCallback(() => {
    if (leaveTimer.current === undefined) return
    clearTimeout(leaveTimer.current)
    leaveTimer.current = undefined
  }, [])
  useEffect(() => cancelLeave, [cancelLeave])

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

  const className = [css.sourceTabsBox, folded ? css.sourceTabsBoxFold : '', picked ? css.sourceTabsBoxPicked : ''].filter(Boolean).join(' ')
  return h(
    'div',
    {
      className,
      onMouseEnter: cancelLeave,
      onMouseLeave: () => {
        // Grace period: a pointer swept out by the fold itself must not count
        // as "left the strip", or the next move reopens it at once.
        cancelLeave()
        leaveTimer.current = setTimeout(() => {
          leaveTimer.current = undefined
          setPicked(false)
        }, LEAVE_GRACE_MS)
      },
      onBlur: (event: FocusEvent<HTMLDivElement>) => {
        // Focus left the strip entirely (the clicked pill keeps focus inside).
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          cancelLeave()
          setPicked(false)
        }
      }
    },
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
          onSelect: () => {
            setPicked(true)
            onSelect(item.id)
          },
          onDelete: item.deletable === true ? () => onDelete(item.id) : undefined,
          onEdit: item.editable === true ? () => onEdit(item.id) : undefined
        })
      )
    )
  )
}
