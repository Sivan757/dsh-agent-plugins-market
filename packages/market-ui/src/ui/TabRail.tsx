/**
 * The market tab row.
 *
 * One horizontal rail that scrolls instead of shrinking its items. Tabs the user puts
 * away stay in the same rail, dimmed at the end, with no group label and no divider: the
 * row is a list of tabs and nothing else. Sorting is a long press followed by a drag, for
 * a mouse and a finger alike, so a click never turns into a move by accident.
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
  /** Tabs shown in the row, in their stored order. */
  items: readonly TabRailItem<T>[]
  /** Tabs put away: same row, after the visible ones, dimmed. */
  stowed?: readonly TabRailItem<T>[]
  /** Commit a move between two positions of the visible row. */
  onReorder?: (from: number, to: number) => void
  /** Put one tab away; omitted by a surface that does not let the user stow. */
  onStow?: (value: T) => void
  /** Put one tab back. */
  onUnstow?: (value: T) => void
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

/** Where a drag currently sits: over the row, or past its right edge. */
interface DragState {
  from: number
  /** Landing position among the visible tabs. */
  to: number
  /** True when the pointer is past the last visible tab, which means "put this away". */
  away: boolean
}

/**
 * One horizontal tab rail with long-press reordering and a dimmed put-away tail.
 * @param props - the row's tabs, its put-away tabs, and the callbacks that move them.
 * @returns the rail; the selected tab carries the moving pill.
 */
export function TabRail<T extends string>({ value, onChange, label, items, stowed = [], onReorder, onStow, onUnstow }: TabRailProps<T>): ReactNode {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<DragState | undefined>(undefined)
  const press = useRef<{ index: number; x: number; started: boolean; away: boolean; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined)
  const [holding, setHolding] = useState<number | undefined>(undefined)
  const swallowClick = useRef(false)
  const [pill, setPill] = useState<{ left: number; width: number } | undefined>(undefined)
  const [edges, setEdges] = useState({ left: false, right: false })
  const all = [...items, ...stowed]
  const [focused, setFocused] = useState<number>(() =>
    Math.max(
      0,
      all.findIndex(item => item.value === value)
    )
  )
  const layoutKey = items.map(item => item.value).join('|') + '#' + stowed.map(item => item.value).join('|')

  useEffect(() => {
    const index = all.findIndex(item => item.value === value)
    if (index >= 0) setFocused(index)
  }, [value, layoutKey])

  const measurePill = useCallback(() => {
    const rail = railRef.current
    if (rail === null) return
    const active = rail.querySelector<HTMLElement>('[data-value="' + value + '"]')
    if (active === null) {
      setPill(current => (current === undefined ? current : undefined))
      return
    }
    const next = { left: active.offsetLeft, width: active.offsetWidth }
    setPill(current => (current !== undefined && current.left === next.left && current.width === next.width ? current : next))
  }, [value])

  const measureEdges = useCallback(() => {
    const rail = railRef.current
    if (rail === null) return
    const left = rail.scrollLeft > 1
    const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1
    setEdges(current => (current.left === left && current.right === right ? current : { left, right }))
  }, [])

  useLayoutEffect(() => {
    measurePill()
    measureEdges()
    const rail = railRef.current
    const observer =
      typeof ResizeObserver === 'undefined' || rail === null
        ? undefined
        : new ResizeObserver(() => {
            measurePill()
            measureEdges()
          })
    if (rail !== null) observer?.observe(rail)
    const onResize = (): void => {
      measurePill()
      measureEdges()
    }
    window.addEventListener('resize', onResize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [layoutKey, measureEdges, measurePill])

  /** Map the wheel to the row's own axis while it can scroll that way. */
  const onWheel = (event: { deltaX: number; deltaY: number; preventDefault: () => void }): void => {
    const rail = railRef.current
    if (rail === null || rail.scrollWidth - rail.clientWidth <= 1) return
    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    if (delta === 0) return
    event.preventDefault()
    rail.scrollBy({ left: delta, behavior: 'auto' })
  }

  const scrollBy = (direction: -1 | 1): void => {
    const rail = railRef.current
    if (rail === null) return
    rail.scrollBy({ left: direction * Math.max(120, Math.round(rail.clientWidth * 0.8)), behavior: 'smooth' })
  }

  /** The visible position the pointer sits over, from each tab's midpoint. */
  const indexAt = useCallback((x: number): number => {
    const rail = railRef.current
    if (rail === null) return 0
    const tabs = [...rail.querySelectorAll<HTMLElement>('[role="tab"][data-stowed="false"]')]
    for (const [index, tab] of tabs.entries()) {
      const box = tab.getBoundingClientRect()
      if (x < box.left + box.width / 2) return index
    }
    return Math.max(0, tabs.length - 1)
  }, [])

  /** True once the pointer is past the last visible tab, which is the put-away gesture. */
  const awayAt = useCallback((x: number): boolean => {
    const rail = railRef.current
    if (rail === null) return false
    const tabs = [...rail.querySelectorAll<HTMLElement>('[role="tab"][data-stowed="false"]')]
    const last = tabs[tabs.length - 1]
    if (last === undefined) return false
    return x > last.getBoundingClientRect().right + 16
  }, [])

  const finish = useCallback(() => {
    if (press.current?.timer !== undefined) clearTimeout(press.current.timer)
    setHolding(undefined)
    press.current = undefined
    setDrag(current => {
      if (current === undefined) return undefined
      const moving = items[current.from]
      if (current.away) {
        if (moving !== undefined && onStow !== undefined) queueMicrotask(() => onStow(moving.value))
        return undefined
      }
      if (current.from !== current.to && onReorder !== undefined) {
        const { from, to } = current
        queueMicrotask(() => onReorder(from, to))
      }
      return undefined
    })
  }, [items, onReorder, onStow])

  useEffect(() => {
    if (onReorder === undefined && onStow === undefined) return
    const move = (event: PointerEvent): void => {
      const pending = press.current
      if (pending === undefined || !pending.started) return
      const away = awayAt(event.clientX)
      pending.away = away
      setDrag({ from: pending.index, to: indexAt(event.clientX), away })
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
  }, [awayAt, finish, indexAt, onReorder, onStow])

  /**
   * Arrow keys move selection and focus together, Home and End jump, and Alt with an
   * arrow puts the focused tab away or back.
   */
  const onKeyDown = (event: { key: string; altKey?: boolean; preventDefault: () => void }): void => {
    const last = all.length - 1
    const current = all[focused]
    if (event.altKey === true && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (current === undefined) return
      const isStowed = stowed.some(item => item.value === current.value)
      if (event.key === 'ArrowDown' && !isStowed) onStow?.(current.value)
      if (event.key === 'ArrowUp' && isStowed) onUnstow?.(current.value)
      return
    }
    const next =
      event.key === 'ArrowRight' ? Math.min(last, focused + 1) : event.key === 'ArrowLeft' ? Math.max(0, focused - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1
    if (next < 0) return
    event.preventDefault()
    setFocused(next)
    railRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
    const item = all[next]
    if (item === undefined) return
    if (stowed.some(entry => entry.value === item.value)) onUnstow?.(item.value)
    onChange(item.value)
  }

  const tabButton = (item: TabRailItem<T>, index: number, isStowed: boolean): ReactNode => {
    const selected = item.value === value
    const dragging = drag !== undefined && !isStowed && drag.from === index
    const landing = drag !== undefined && !drag.away && !isStowed && drag.from !== index && drag.to === index
    const classes = [
      css.tab,
      selected ? css.tabActive : '',
      isStowed ? css.tabStowed : '',
      dragging ? css.tabDragging : '',
      landing ? css.tabLanding : '',
      holding === index ? css.tabHolding : ''
    ]
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
        'data-stowed': String(isStowed),
        tabIndex: index === focused ? 0 : -1,
        className: classes.filter(Boolean).join(' '),
        draggable: false,
        onClick: () => {
          if (swallowClick.current) {
            swallowClick.current = false
            return
          }
          if (isStowed) onUnstow?.(item.value)
          onChange(item.value)
        },
        onFocus: () => setFocused(index),
        onPointerDown: (event: { button: number; clientX: number }) => {
          if ((onReorder === undefined && onStow === undefined) || event.button !== 0 || isStowed) return
          press.current = { index, x: event.clientX, started: false, away: false }
          setHolding(index)
          press.current.timer = setTimeout(() => {
            const pending = press.current
            if (pending === undefined || pending.index !== index || pending.started) return
            pending.started = true
            setDrag({ from: index, to: index, away: false })
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
          if (press.current?.started === true) swallowClick.current = true
          if (press.current?.timer !== undefined) clearTimeout(press.current.timer)
          setHolding(undefined)
          press.current = undefined
        }
      },
      item.text
    )
  }

  return h(
    'div',
    { className: css.row },
    h(
      'div',
      { className: css.wrap },
      h(
        'div',
        { ref: railRef, className: css.rail, role: 'tablist', 'aria-label': label, onKeyDown, onWheel, onScroll: measureEdges },
        pill === undefined
          ? null
          : h('span', {
              key: 'pill',
              'aria-hidden': 'true',
              className: css.pill,
              style: { transform: 'translateX(' + String(pill.left) + 'px)', width: String(pill.width) + 'px' }
            }),
        items.map((item, index) => tabButton(item, index, false)),
        stowed.map((item, offset) => tabButton(item, items.length + offset, true))
      ),
      edges.left
        ? h(
            'button',
            { type: 'button', className: css.scrollButton + ' ' + css.scrollLeft + ' ' + css.scrollVisible, 'aria-label': label + ' · 向前', onClick: () => scrollBy(-1) },
            h(IconChevronLeftOutlineMedium, { size: 14 })
          )
        : null,
      edges.right
        ? h(
            'button',
            { type: 'button', className: css.scrollButton + ' ' + css.scrollRight + ' ' + css.scrollVisible, 'aria-label': label + ' · 向后', onClick: () => scrollBy(1) },
            h(IconChevronRightOutlineMedium, { size: 14 })
          )
        : null
    )
  )
}
