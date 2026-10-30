/**
 * The market tab row.
 *
 * One horizontal rail of tabs with the host's own chip look: the selected tab carries a
 * raised background, nothing else does. When the tabs are wider than the row, two inline
 * buttons step the row one tab at a time and the clipped edge fades out.
 *
 * Reordering is a long press followed by a drag, for a mouse and a finger alike: a press
 * that moves first is a scroll or a click that wobbled, and neither should sort anything.
 * @module client/ui/TabRail
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronLeftOutlineMedium, IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
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
  /** Tabs, in their stored order. */
  items: readonly TabRailItem<T>[]
  /** Commit a move between two positions. */
  onReorder?: (from: number, to: number) => void
}

/** A press shorter than this is a click, so a slightly shaky tap still selects. */
const DRAG_THRESHOLD_PX = 4
/**
 * How long a press must be held before it drags.
 *
 * Sorting is a deliberate act. A press that moves before the hold is spent scrolling the
 * rail, or is a click that wobbled; either way it must not reorder anything, and a mouse
 * held for the same time reads as the same intent as a finger.
 */
const DRAG_HOLD_MS = 280

/**
 * One horizontal tab rail with long-press reordering.
 * @param props - the row's tabs and the callback that persists a move.
 * @returns the rail, with a step button on each side that can scroll.
 */
export function TabRail<T extends string>({ value, onChange, label, items, onReorder }: TabRailProps<T>): ReactNode {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<{ from: number; to: number; dx: number } | undefined>(undefined)
  const press = useRef<{ index: number; x: number; started: boolean; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined)
  const [holding, setHolding] = useState<number | undefined>(undefined)
  const swallowClick = useRef(false)
  const [edges, setEdges] = useState({ left: false, right: false })
  const [focused, setFocused] = useState<number>(() =>
    Math.max(
      0,
      items.findIndex(item => item.value === value)
    )
  )
  const layoutKey = items.map(item => item.value).join('|')
  /**
   * The dissolve at a clipped edge, as a mask over the row itself.
   *
   * A mask is the only version that needs no colour: the tabs fade into whatever
   * surface the panel sits on, in either theme, so the band cannot read as a
   * stray strip of the wrong background.
   */
  const edgeMask =
    edges.left && edges.right
      ? 'linear-gradient(to right, transparent 0, #000 40px, #000 calc(100% - 40px), transparent 100%)'
      : edges.left
        ? 'linear-gradient(to right, transparent 0, #000 40px)'
        : edges.right
          ? 'linear-gradient(to right, #000 calc(100% - 40px), transparent 100%)'
          : undefined

  useEffect(() => {
    const index = items.findIndex(item => item.value === value)
    if (index >= 0) setFocused(index)
  }, [value, layoutKey])

  /** Which sides still hide content, and so which buttons and fades apply. */
  const measureEdges = useCallback(() => {
    const rail = railRef.current
    if (rail === null) return
    const left = rail.scrollLeft > 1
    const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1
    setEdges(current => (current.left === left && current.right === right ? current : { left, right }))
  }, [])

  useLayoutEffect(() => {
    measureEdges()
    const rail = railRef.current
    const observer = typeof ResizeObserver === 'undefined' || rail === null ? undefined : new ResizeObserver(measureEdges)
    if (rail !== null) observer?.observe(rail)
    window.addEventListener('resize', measureEdges)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measureEdges)
    }
  }, [layoutKey, measureEdges])

  /**
   * Step the row by exactly one tab.
   *
   * A viewport-sized jump loses the reader's place: after one click they cannot tell which
   * tab they landed on. One tab width keeps the movement countable, and the width is read
   * from the first tab rather than assumed.
   */
  const step = (direction: -1 | 1): void => {
    const rail = railRef.current
    if (rail === null) return
    const first = rail.querySelector<HTMLElement>('[role="tab"]')
    const width = first === null ? 0 : first.offsetWidth + 1
    rail.scrollBy({ left: direction * Math.max(width, 24), behavior: 'smooth' })
  }

  /** Map the wheel to the row's own axis while it can scroll that way. */
  const onWheel = (event: { deltaX: number; deltaY: number; preventDefault: () => void }): void => {
    const rail = railRef.current
    if (rail === null || rail.scrollWidth - rail.clientWidth <= 1) return
    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    if (delta === 0) return
    event.preventDefault()
    rail.scrollBy({ left: delta, behavior: 'auto' })
  }

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

  const finish = useCallback(() => {
    if (press.current?.timer !== undefined) clearTimeout(press.current.timer)
    setHolding(undefined)
    press.current = undefined
    setDrag(current => {
      if (current === undefined) return undefined
      if (current.from !== current.to && onReorder !== undefined) {
        const { from, to } = current
        queueMicrotask(() => onReorder(from, to))
      }
      return undefined
    })
  }, [onReorder])

  useEffect(() => {
    if (onReorder === undefined) return
    const move = (event: PointerEvent): void => {
      const pending = press.current
      if (pending === undefined || !pending.started) return
      setDrag({ from: pending.index, to: indexAt(event.clientX), dx: event.clientX - pending.x })
    }
    const up = (): void => {
      if (press.current?.started !== true) return
      swallowClick.current = true
      finish()
    }
    // A release outside the page never reaches us: the window loses focus instead, which
    // is the last chance to put the tab down. Without this the row can stay mid-drag.
    const abandon = (): void => {
      if (press.current?.started === true) finish()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', abandon)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', abandon)
    }
  }, [finish, indexAt, onReorder])

  /** Arrow keys move selection and focus together; Home and End jump. */
  const onKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    const last = items.length - 1
    const next =
      event.key === 'ArrowRight' ? Math.min(last, focused + 1) : event.key === 'ArrowLeft' ? Math.max(0, focused - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1
    if (next < 0) return
    event.preventDefault()
    setFocused(next)
    railRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
    const item = items[next]
    if (item !== undefined) onChange(item.value)
  }

  return h(
    'div',
    { className: css.wrap },
    h(
      'div',
      {
        ref: railRef,
        className: css.rail,
        role: 'tablist',
        'aria-label': label,
        onKeyDown,
        onWheel,
        onScroll: measureEdges,
        style: edgeMask === undefined ? undefined : { maskImage: edgeMask, WebkitMaskImage: edgeMask }
      },
      items.map((item, index) => {
        const selected = item.value === value
        const dragging = drag !== undefined && drag.from === index
        const landing = drag !== undefined && drag.from !== index && drag.to === index
        return h(
          'button',
          {
            key: item.value,
            id: item.id,
            type: 'button',
            role: 'tab',
            'aria-selected': selected,
            'aria-controls': item.panelId,
            'data-value': item.value,
            tabIndex: index === focused ? 0 : -1,
            // Pressing draws the hold ring; once the hold is spent the tab lifts and follows
            // the pointer, which is the only way a drag can be told from a click.
            className: [
              css.tab,
              selected ? css.tabActive : '',
              dragging ? css.tabDragging : '',
              landing ? css.tabLanding : '',
              holding === index ? (drag === undefined ? css.tabPressing : css.tabHolding) : ''
            ]
              .filter(Boolean)
              .join(' '),
            style: dragging ? { transform: 'translate(' + String(drag.dx) + 'px, -2px) scale(1.03)' } : undefined,
            draggable: false,
            onClick: () => {
              if (swallowClick.current) {
                swallowClick.current = false
                return
              }
              onChange(item.value)
            },
            onFocus: () => setFocused(index),
            onPointerDown: (event: { button: number; clientX: number }) => {
              if (onReorder === undefined || event.button !== 0) return
              press.current = { index, x: event.clientX, started: false }
              setHolding(index)
              press.current.timer = setTimeout(() => {
                const pending = press.current
                if (pending === undefined || pending.index !== index || pending.started) return
                pending.started = true
                setDrag({ from: index, to: index, dx: 0 })
              }, DRAG_HOLD_MS)
            },
            onPointerMove: (event: { clientX: number }) => {
              const pending = press.current
              if (pending === undefined || pending.index !== index || pending.started) return
              if (Math.abs(event.clientX - pending.x) < DRAG_THRESHOLD_PX) return
              // Moved before the hold: this press belongs to the browser, not to sorting.
              if (pending.timer !== undefined) clearTimeout(pending.timer)
              setHolding(undefined)
              press.current = undefined
            },
            onPointerUp: () => {
              if (press.current?.started === true) {
                swallowClick.current = true
                finish()
                return
              }
              if (press.current?.timer !== undefined) clearTimeout(press.current.timer)
              setHolding(undefined)
              press.current = undefined
            }
          },
          item.text
        )
      })
    ),
    // Both overlays sit inside the rail's border, over the tabs: the fade masks the letters
    // running under the edge, and the arrow floats above it. Neither is laid out, so the row
    // keeps its width when they appear.

    edges.left
      ? h('button', { type: 'button', className: css.stepLeft, 'aria-label': label + ' · 向前一个', onClick: () => step(-1) }, h(IconChevronLeftOutlineMedium, { size: 12 }))
      : null,
    edges.right
      ? h('button', { type: 'button', className: css.stepRight, 'aria-label': label + ' · 向后一个', onClick: () => step(1) }, h(IconChevronRightOutlineMedium, { size: 12 }))
      : null
  )
}
