/**
 * The market tab row.
 *
 * One horizontal rail that scrolls instead of shrinking its items, so a label is never
 * truncated. Tabs the user puts away stay in the same rail, after a divider and dimmed,
 * because a control whose state can only be read from a number is a control the user has
 * to remember. Clicking a dimmed tab puts it back, dragging one across the divider puts it
 * away, and both directions animate so the tab is seen to move rather than to jump.
 *
 * Motion is here to explain a change, not to decorate it: the selection pill slides to the
 * tab it now belongs to, a dragged tab lifts, the landing caret shows where it will go, and
 * a tab crossing the divider fades between the two groups. All of it turns off under
 * `prefers-reduced-motion`.
 * @module client/ui/TabRail
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
  /** Tabs shown in the rail, in their stored order. */
  items: readonly TabRailItem<T>[]
  /** Tabs put away: same rail, after the divider, dimmed. */
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
 * How long a touch must be held before it drags instead of scrolling.
 *
 * The rail scrolls sideways, and on a touch screen a sideways swipe is how that scroll
 * happens. Taking every swipe as a drag would make the row impossible to scroll, and
 * every swipe as a scroll would make it impossible to reorder, so touch waits for a hold.
 */
const TOUCH_HOLD_MS = 300

/** Where a drag currently sits: over the visible row, or over the stowed group. */
interface DragState {
  from: number
  /** Landing position among the visible tabs. */
  to: number
  /** True when the pointer is past the divider, which means "put this away". */
  away: boolean
}

/**
 * One horizontal tab rail with pointer reordering and an inline stowed group.
 * @param props - the row's tabs, its stowed tabs, and the callbacks that move them.
 * @returns the rail; the selected tab carries the moving pill.
 */
export function TabRail<T extends string>({ value, onChange, label, items, stowed = [], onReorder, onStow, onUnstow }: TabRailProps<T>): ReactNode {
  const railRef = useRef<HTMLDivElement | null>(null)
  const dividerRef = useRef<HTMLSpanElement | null>(null)
  const [drag, setDrag] = useState<DragState | undefined>(undefined)
  const press = useRef<{ index: number; x: number; started: boolean; away: boolean; timer?: ReturnType<typeof setTimeout> } | undefined>(undefined)
  const [holding, setHolding] = useState<number | undefined>(undefined)
  const swallowClick = useRef(false)
  /** The pill's box in rail coordinates; `undefined` until the first measurement. */
  const [pill, setPill] = useState<{ left: number; width: number } | undefined>(undefined)
  /** Keys that arrived in the stowed group since the last render, so they animate in. */
  const previousStowed = useRef<readonly string[]>(stowed.map(item => item.value))
  const [entering, setEntering] = useState<readonly string[]>([])
  const all = [...items, ...stowed]
  const [focused, setFocused] = useState<number>(() =>
    Math.max(
      0,
      all.findIndex(item => item.value === value)
    )
  )

  // Both callers build their item lists inline, so the layout is compared by key: an
  // array identity would re-run this sync after every render and undo an arrow-key move.
  const layoutKey = items.map(item => item.value).join('|') + '#' + stowed.map(item => item.value).join('|')
  useEffect(() => {
    const index = all.findIndex(item => item.value === value)
    if (index >= 0) setFocused(index)
  }, [value, layoutKey])

  // A tab that just moved into the stowed group fades in from the divider, so the eye
  // follows it instead of finding it already there.
  useEffect(() => {
    const now = stowed.map(item => item.value)
    const added = now.filter(key => !previousStowed.current.includes(key))
    previousStowed.current = now
    if (added.length === 0) return
    setEntering(added)
    const timer = setTimeout(() => setEntering([]), 260)
    return () => clearTimeout(timer)
  }, [stowed])

  // The pill is measured, not inferred: labels differ in width, and a font can arrive
  // after first paint. A ResizeObserver on the rail covers both without polling.
  useLayoutEffect(() => {
    const rail = railRef.current
    if (rail === null) return
    const measure = (): void => {
      const active = rail.querySelector<HTMLElement>('[data-value="' + value + '"]')
      if (active === null) {
        setPill(current => (current === undefined ? current : undefined))
        return
      }
      const next = { left: active.offsetLeft, width: active.offsetWidth }
      // A same-sized box is not a change; without this the object would be new every
      // measure and re-render forever, which jsdom's zero-width boxes would hit at once.
      setPill(current => (current !== undefined && current.left === next.left && current.width === next.width ? current : next))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(rail)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [value, layoutKey])

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

  /** True when the pointer is past the divider, which is the gesture that puts a tab away. */
  const awayAt = useCallback((x: number): boolean => {
    const divider = dividerRef.current
    if (divider === null) return false
    return x >= divider.getBoundingClientRect().left
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
      if (press.current?.started !== true) return
      const away = awayAt(event.clientX)
      press.current.away = away
      setDrag(current => (current === undefined ? current : { from: current.from, to: indexAt(event.clientX), away }))
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
   * arrow puts the focused tab away or back. Moving the selection alone would leave
   * focus on a tab that just became unreachable, which is what a roving tab stop exists
   * to prevent.
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
    // Selecting a stowed tab means asking for it back; leaving it selected while stowed
    // would render a tab the row claims is put away.
    if (stowed.some(entry => entry.value === item.value)) onUnstow?.(item.value)
    onChange(item.value)
  }

  /** One tab button, shared by both groups so a tab looks the same on either side. */
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
      entering.includes(item.value) ? css.tabEntering : '',
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
        onPointerDown: (event: { button: number; clientX: number; pointerType?: string }) => {
          if ((onReorder === undefined && onStow === undefined) || event.button !== 0) return
          if (isStowed) return
          press.current = { index, x: event.clientX, started: false, away: false }
          if (event.pointerType === 'mouse' || event.pointerType === undefined) return
          setHolding(index)
          press.current.timer = setTimeout(() => {
            const pending = press.current
            if (pending === undefined || pending.index !== index || pending.started) return
            pending.started = true
            setDrag({ from: index, to: index, away: false })
          }, TOUCH_HOLD_MS)
        },
        onPointerMove: (event: { clientX: number; pointerType?: string }) => {
          const pending = press.current
          if (pending === undefined || pending.index !== index) return
          if (!pending.started && Math.abs(event.clientX - pending.x) < DRAG_THRESHOLD_PX) return
          if (!pending.started) {
            if (event.pointerType !== undefined && event.pointerType !== 'mouse') {
              clearTimeout(pending.timer)
              setHolding(undefined)
              press.current = undefined
              return
            }
            clearTimeout(pending.timer)
            setHolding(undefined)
          }
          pending.started = true
          const away = awayAt(event.clientX)
          pending.away = away
          setDrag({ from: index, to: indexAt(event.clientX), away })
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
      { ref: railRef, className: css.rail, role: 'tablist', 'aria-label': label, onKeyDown },
      pill === undefined
        ? null
        : h('span', { key: 'pill', 'aria-hidden': 'true', className: css.pill, style: { transform: 'translateX(' + String(pill.left) + 'px)', width: String(pill.width) + 'px' } }),
      items.map((item, index) => tabButton(item, index, false)),
      // The group exists even when empty: the divider is the drop target that puts a tab
      // away, so a row with nothing stowed yet still has to offer the gesture.
      h(
        'span',
        { key: 'stow-group', className: drag?.away === true ? css.groupActive : css.group },
        h('span', { ref: dividerRef, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': label + ' · 已收起', tabIndex: -1, className: css.divider }),
        stowed.length === 0 ? null : h('span', { className: css.groupLabel, 'aria-hidden': 'true' }, '已收起 ' + String(stowed.length)),
        stowed.map((item, offset) => tabButton(item, items.length + offset, true))
      )
    )
  )
}
