/**
 * The market tab row.
 *
 * Replaces the host's equal-column segmented track for the two surfaces that own a
 * tab list the user can rearrange. Equal columns are why a ninth tab used to be cut
 * off at the row edge, and they leave no room for the gesture this row needs:
 * dragging a tab to a new position.
 *
 * The row is one horizontal rail that scrolls instead of shrinking its items, so a
 * label is never truncated, and it fades at an edge that has more content. Dragging
 * is pointer-only by design: the workspace already reorders with Alt and an arrow
 * key, so a second keyboard path would add a mode without adding reach.
 * @module client/ui/TabRail
 */
import { createElement as h, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import css from './tab-rail.module.css'

/** One tab: its wire value, its rendered label, and the ids the ARIA wiring needs. */
export interface TabRailItem<T extends string> {
  value: T
  /** Rendered label. A string, so the row can compare and lay it out. */
  text: string
  id: string
  panelId: string
}

export interface TabRailProps<T extends string> {
  value: T
  onChange: (value: T) => void
  /** Localized accessible name of the tab list. */
  label: string
  items: readonly TabRailItem<T>[]
  /**
   * Commit a move from one rendered position to another.
   * Omitted by a surface that does not let the user sort its row.
   */
  onReorder?: (from: number, to: number) => void
  /** A control pinned to the row's trailing edge, outside the tab list. */
  trailing?: ReactNode
}

/** A press shorter than this is a click, so a slightly shaky tap still selects. */
const DRAG_THRESHOLD_PX = 4
/**
 * How long a touch must be held before it drags instead of scrolling.
 *
 * The rail scrolls sideways to reach a tab that does not fit, and on a touch screen a
 * sideways swipe is how that scroll happens. Taking every swipe as a drag would make
 * the row impossible to scroll, and taking every swipe as a scroll would make it
 * impossible to reorder, so touch waits for a hold and a mouse does not: its press is
 * unambiguous.
 */
const TOUCH_HOLD_MS = 300

/**
 * One horizontal tab rail with pointer reordering.
 * @param props - the row's tabs, selection, and optional reorder callback.
 * @returns the tab list and its trailing control.
 */
export function TabRail<T extends string>({ value, onChange, label, items, onReorder, trailing }: TabRailProps<T>): ReactNode {
  const railRef = useRef<HTMLDivElement | null>(null)
  /** Index being dragged, and the position the pointer is currently over. */
  const [drag, setDrag] = useState<{ from: number; to: number } | undefined>(undefined)
  /** The press that may still become a drag. In a ref, so a move alone does not re-render. */
  const press = useRef<{ index: number; x: number; started: boolean; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined)
  /** The tab held down on a touch screen, which suppresses the browser's sideways pan. */
  const [holding, setHolding] = useState<number | undefined>(undefined)
  /** Set when a drag ends, so the click the browser sends next does not select. */
  const swallowClick = useRef(false)
  /** Roving tab stop: exactly one tab is reachable with Tab, the selected one by default. */
  const [focused, setFocused] = useState<number>(() =>
    Math.max(
      0,
      items.findIndex(item => item.value === value)
    )
  )

  useEffect(() => {
    const index = items.findIndex(item => item.value === value)
    if (index >= 0) setFocused(index)
  }, [items, value])

  /** The position the pointer sits over, from each tab's midpoint. */
  const indexAt = useCallback((x: number): number => {
    const rail = railRef.current
    if (rail === null) return 0
    const tabs = [...rail.querySelectorAll<HTMLElement>('[role="tab"]')]
    for (const [index, tab] of tabs.entries()) {
      const box = tab.getBoundingClientRect()
      if (x < box.left + box.width / 2) return index
    }
    return Math.max(0, tabs.length - 1)
  }, [])

  /** Finish a drag, committing the move once the highlight has been cleared. */
  const finish = useCallback(() => {
    if (press.current?.timer !== undefined) clearTimeout(press.current.timer)
    setHolding(undefined)
    press.current = undefined
    setDrag(current => {
      if (current !== undefined && current.from !== current.to && onReorder !== undefined) {
        const { from, to } = current
        queueMicrotask(() => onReorder(from, to))
      }
      return undefined
    })
  }, [onReorder])

  // The listeners are always attached while reordering is possible, and each one
  // reads the press ref: a listener that appeared only after the first move would
  // miss a pointerup that lands in the same frame, which is exactly what a fast drag
  // does.
  useEffect(() => {
    if (onReorder === undefined) return
    const move = (event: PointerEvent): void => {
      if (press.current?.started !== true) return
      setDrag(current => (current === undefined ? current : { ...current, to: indexAt(event.clientX) }))
    }
    const up = (): void => {
      if (press.current?.started !== true) return
      swallowClick.current = true
      finish()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [finish, indexAt, onReorder])

  /** Arrow keys move the selection, Home and End jump, matching the host's tab walk. */
  const onKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    const last = items.length - 1
    const next =
      event.key === 'ArrowRight' ? Math.min(last, focused + 1) : event.key === 'ArrowLeft' ? Math.max(0, focused - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1
    if (next < 0) return
    event.preventDefault()
    setFocused(next)
    const item = items[next]
    if (item !== undefined) onChange(item.value)
  }

  return h(
    'div',
    { className: css.row },
    h(
      'div',
      { ref: railRef, className: css.rail, role: 'tablist', 'aria-label': label, onKeyDown },
      items.map((item, index) => {
        const selected = item.value === value
        const dragging = drag !== undefined && drag.from === index
        const landing = drag !== undefined && drag.from !== index && drag.to === index
        const classes = [css.tab, selected ? css.tabActive : '', dragging ? css.tabDragging : '', landing ? css.tabLanding : '', holding === index ? css.tabHolding : '']
        return h(
          'button',
          {
            key: item.value,
            id: item.id,
            type: 'button',
            role: 'tab',
            'aria-selected': selected,
            'aria-controls': item.panelId,
            tabIndex: index === focused ? 0 : -1,
            className: classes.filter(Boolean).join(' '),
            'data-value': item.value,
            draggable: false,
            onClick: () => {
              if (swallowClick.current) {
                swallowClick.current = false
                return
              }
              onChange(item.value)
            },
            onFocus: () => setFocused(index),
            onPointerDown: (event: { button: number; clientX: number; pointerType?: string }) => {
              if (onReorder === undefined || event.button !== 0) return
              press.current = { index, x: event.clientX, started: false }
              if (event.pointerType === 'mouse' || event.pointerType === undefined) return
              // A hold on a touch screen takes the gesture over from the sideways pan,
              // which is the only way a swipe can mean both things.
              setHolding(index)
              press.current.timer = setTimeout(() => {
                const current = press.current
                if (current === undefined || current.index !== index || current.started) return
                current.started = true
                setDrag({ from: index, to: index })
              }, TOUCH_HOLD_MS)
            },
            onPointerMove: (event: { clientX: number; pointerType?: string }) => {
              const current = press.current
              if (current === undefined || current.index !== index) return
              if (!current.started && Math.abs(event.clientX - current.x) < DRAG_THRESHOLD_PX) return
              // Before a hold completes, a touch move is the browser scrolling the rail.
              if (!current.started) {
                if (event.pointerType !== undefined && event.pointerType !== 'mouse') {
                  clearTimeout(current.timer)
                  setHolding(undefined)
                  press.current = undefined
                  return
                }
                clearTimeout(current.timer)
                setHolding(undefined)
              }
              current.started = true
              setDrag({ from: index, to: indexAt(event.clientX) })
            },
            onPointerUp: () => {
              // A press that never became a drag stays a click, which the browser
              // sends as usual; only a real drag swallows the selection change.
              if (press.current?.started === true) swallowClick.current = true
              if (press.current?.timer !== undefined) clearTimeout(press.current.timer)
              setHolding(undefined)
              press.current = undefined
            }
          },
          h('span', { className: css.tabText }, item.text)
        )
      })
    ),
    trailing === undefined ? null : h('div', { className: css.trailing }, trailing)
  )
}
