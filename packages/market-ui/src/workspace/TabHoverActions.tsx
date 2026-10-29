/**
 * The actions a tab row offers on long hover: move one place, stow, or open the
 * full list, plus the one-time guide that teaches the pause.
 *
 * A pointer that rests on a tab for a moment is asking about that tab, so the
 * answer appears above it instead of in a menu at the far end of the row. The
 * row keeps no button for this: the whole affordance is the pause itself, which
 * is what keeps the row's width for the tabs.
 *
 * The bubble is a shortcut, not the only path. Every action here is also in the
 * tab manager (arrows and a checkbox) and on the row's own keyboard handlers, so
 * a keyboard or screen-reader user reaches the same operations without hovering.
 * @module client/workspace/TabHoverActions
 */
import { createElement as h, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../i18n.js'
import css from './workspace.module.css'

/**
 * How long a pointer must rest on a tab before the bubble appears.
 *
 * Long enough that crossing the row does not open anything, short enough that a
 * deliberate pause reads as intent. The number is one constant so the prototype,
 * the tests and the UI cannot drift apart.
 */
export const TAB_HOVER_ARM_MS = 620

/** How long the bubble survives after the pointer leaves, so it can be reached. */
export const TAB_HOVER_DISMISS_MS = 240

/** One tab the hook may describe. */
export interface HoverableTab {
  /** The tab key, which is also the wire value. */
  key: string
  /** Localized label, the same text the tab renders. */
  label: string
}

/** Which tab the pointer is resting on, and where its centre and top edge are. */
export interface TabHoverTarget extends HoverableTab {
  /** Viewport x of the tab's centre, so the bubble can be centred over it. */
  x: number
  /** Viewport y of the tab's top edge, so the bubble can sit above it. */
  top: number
}

/** What the pointer listeners need to be attached to the row. */
export interface TabHoverBinding {
  onPointerOver: (event: { target: EventTarget | null }) => void
  onPointerOut: (event: { target: EventTarget | null; relatedTarget: EventTarget | null }) => void
}

/** The hook result: the current target and the row's listeners. */
export interface TabHoverState {
  target: TabHoverTarget | undefined
  bind: TabHoverBinding
  /** Close at once, for an action that changes the row. */
  close: () => void
  /** Keep the bubble alive while the pointer is inside it. */
  hold: () => void
}

/** Read the tab key out of a rendered tab, which the host ids by that key. */
function keyOf(element: Element): string | undefined {
  const id = element.getAttribute('id') ?? ''
  const prefix = 'agent-plugins-tab-'
  return id.startsWith(prefix) ? id.slice(prefix.length) : undefined
}

/** Whether one node contains another, tolerating a null node. */
function holds(container: Element | null, node: EventTarget | null): boolean {
  return container !== null && node instanceof Node && container.contains(node)
}

/**
 * Watch the row for a pointer resting on one tab.
 *
 * @param tabs - every tab the row can show, for its label.
 * @param pinnedKey - the tab that owns the row's first column. It has nowhere to
 *   move and nothing to stow, so pausing on it opens nothing.
 * @returns the armed target, the row listeners, and the two bubble controls.
 */
export function useTabHover(tabs: readonly HoverableTab[], pinnedKey: string): TabHoverState {
  const [target, setTarget] = useState<TabHoverTarget | undefined>(undefined)
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const restingOn = useRef<Element | undefined>(undefined)

  const clearTimers = useCallback(() => {
    if (armTimer.current !== undefined) clearTimeout(armTimer.current)
    if (dismissTimer.current !== undefined) clearTimeout(dismissTimer.current)
    armTimer.current = undefined
    dismissTimer.current = undefined
  }, [])

  const close = useCallback(() => {
    clearTimers()
    restingOn.current = undefined
    setTarget(undefined)
  }, [clearTimers])

  const over = useCallback(
    (event: { target: EventTarget | null }) => {
      if (!(event.target instanceof Element)) return
      const tab = event.target.closest('[role="tab"]')
      if (tab === null) return
      if (restingOn.current === tab) {
        // The pointer moved from the label to its container: the pause has not
        // been interrupted, so neither timer should restart.
        if (dismissTimer.current !== undefined) clearTimeout(dismissTimer.current)
        dismissTimer.current = undefined
        return
      }
      const key = keyOf(tab)
      const known = key === undefined ? undefined : tabs.find(candidate => candidate.key === key)
      // The pinned tab would only offer dead buttons, so it opens nothing.
      if (known === undefined || key === undefined || key === pinnedKey) return
      clearTimers()
      restingOn.current = tab
      armTimer.current = setTimeout(() => {
        const rect = tab.getBoundingClientRect()
        setTarget({ key, label: known.label, x: rect.left + rect.width / 2, top: rect.top })
      }, TAB_HOVER_ARM_MS)
    },
    [clearTimers, pinnedKey, tabs]
  )

  const out = useCallback((event: { target: EventTarget | null; relatedTarget: EventTarget | null }) => {
    if (dismissTimer.current !== undefined) clearTimeout(dismissTimer.current)
    dismissTimer.current = undefined
    if (!(event.target instanceof Element)) return
    const tab = event.target.closest('[role="tab"]')
    if (tab === null || tab !== restingOn.current) return
    if (holds(tab, event.relatedTarget)) return
    if (armTimer.current !== undefined) clearTimeout(armTimer.current)
    armTimer.current = undefined
    restingOn.current = undefined
    dismissTimer.current = setTimeout(() => setTarget(undefined), TAB_HOVER_DISMISS_MS)
  }, [])

  const hold = useCallback(() => {
    if (dismissTimer.current !== undefined) clearTimeout(dismissTimer.current)
    dismissTimer.current = undefined
  }, [])

  // A bubble anchored to a moving row would point at nothing, and Escape is the
  // pointer-free way out of an overlay. Both go through close, so the tab stops
  // counting as rested and a later pause arms the bubble again.
  useEffect(() => {
    if (target === undefined) return undefined
    const dismiss = (): void => close()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [close, target])

  useEffect(() => clearTimers, [clearTimers])

  return { target, bind: { onPointerOver: over, onPointerOut: out }, close, hold }
}

export interface TabHoverActionsProps {
  t: Translate
  target: TabHoverTarget
  /** Whether each direction can move this tab in the rendered row. */
  canMoveLeft: boolean
  canMoveRight: boolean
  /** Move the target one place; the workspace persists the new order. */
  onMove: (direction: -1 | 1) => void
  /** Stow the target. */
  onStow: () => void
  /** Keep the bubble alive while the pointer is inside it. */
  onHold: () => void
  /** Start the dismissal countdown when the pointer leaves. */
  onLeave: () => void
}

/** The bubble itself: three actions, anchored above the tab that was paused on. */
export function TabHoverActions({ t, target, canMoveLeft, canMoveRight, onMove, onStow, onHold, onLeave }: TabHoverActionsProps): ReactNode {
  return h(
    'div',
    {
      className: css.tabHover,
      role: 'group',
      'aria-label': target.label,
      'data-tab-hover': target.key,
      style: { left: target.x + 'px', top: target.top + 'px' },
      onPointerEnter: onHold,
      onPointerLeave: onLeave
    },
    h(
      'span',
      { className: css.tabHoverGroup },
      h(
        Button,
        {
          variant: 'ghost',
          size: 'sm',
          className: css.tabHoverButton,
          'aria-label': t('tabManageMoveLeft', { tab: target.label }),
          disabled: !canMoveLeft,
          onClick: () => onMove(-1)
        },
        '\u2190'
      ),
      h(
        Button,
        {
          variant: 'ghost',
          size: 'sm',
          className: css.tabHoverButton,
          'aria-label': t('tabManageMoveRight', { tab: target.label }),
          disabled: !canMoveRight,
          onClick: () => onMove(1)
        },
        '\u2192'
      )
    ),
    h('span', { className: css.tabHoverDivider, 'aria-hidden': true }),
    h(Button, { variant: 'ghost', size: 'sm', className: css.tabHoverButton, onClick: onStow }, t('tabHoverStow'))
  )
}
// One-time onboarding: a gesture with no visible control has to introduce itself
// once. The guide is this bubble's own card with a sentence in place of the
// buttons, anchored to the tab the reader is meant to pause on, so the lesson is
// the thing itself rather than a separate spotlight laid over it.

/** Storage key for "the reader has seen the hover guide in this browser". */
const GUIDE_SEEN_KEY = 'agent-plugins.tab-hover-guide.v1'

/** How long the guide stays before it retires itself. */
export const TAB_HOVER_GUIDE_MS = 6000

/** Read the stored flag; an unreadable store means "not seen", which only costs one repeat. */
function guideSeen(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_SEEN_KEY) === 'seen'
  } catch (error) {
    // A store the browser refuses (private mode, disabled cookies) cannot
    // remember anything, so the guide shows again next time. Costs a repeat.
    if (error instanceof Error) return false
    throw error
  }
}

/** Remember that the guide ran, ignoring a store that will not keep it. */
function markGuideSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_SEEN_KEY, 'seen')
  } catch (error) {
    // Same store, same reason: nothing to record, and nothing to report.
    if (!(error instanceof Error)) throw error
  }
}

/**
 * Show the hover guide once per browser, anchored to one tab.
 *
 * The guide is skipped when the row is too narrow to have a spare tab, because
 * a tab that is ellipsized to a few pixels is not a place to point at.
 * @param enabled - whether the row is in a state where the guide makes sense.
 * @returns the anchor to point at, and the two ways to retire it.
 */
export function useTabHoverGuide(enabled: boolean): { anchor: TabHoverTarget | undefined; dismiss: () => void } {
  const [anchor, setAnchor] = useState<TabHoverTarget | undefined>(undefined)
  const [decided, setDecided] = useState(false)

  useEffect(() => {
    if (!enabled || decided || guideSeen()) {
      setDecided(true)
      return undefined
    }
    // The row mounts before it lays out, so the measuring pass retries rather
    // than giving up on a box that is a frame away from having a width.
    let attempt = 0
    const measure = (): void => {
      attempt += 1
      const tabs = [...document.querySelectorAll('[role="tab"]')]
      const target = tabs[1]
      if (target === undefined) {
        setDecided(true)
        return
      }
      const rect = target.getBoundingClientRect()
      // A tab squeezed below a readable width is not a place to point at.
      if (rect.width < 24 && attempt < 3) {
        timer = setTimeout(measure, 250)
        return
      }
      const id = target.getAttribute('id') ?? ''
      const key = id.startsWith('agent-plugins-tab-') ? id.slice('agent-plugins-tab-'.length) : ''
      setAnchor({ key, label: target.textContent ?? '', x: rect.left + rect.width / 2, top: rect.top })
      setDecided(true)
    }
    let timer = setTimeout(measure, 400)
    return () => clearTimeout(timer)
  }, [decided, enabled])

  const dismiss = useCallback(() => {
    markGuideSeen()
    setAnchor(undefined)
  }, [])

  // The guide is not an overlay the reader has to close: it retires itself, and
  // a pointer press anywhere means the lesson has landed.
  useEffect(() => {
    if (anchor === undefined) return undefined
    const timer = setTimeout(dismiss, TAB_HOVER_GUIDE_MS)
    window.addEventListener('pointerdown', dismiss, { once: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [anchor, dismiss])

  return { anchor, dismiss }
}

export interface TabHoverGuideProps {
  t: Translate
  /** Where to point: the tab's centre and top edge, in viewport coordinates. */
  target: TabHoverTarget
  /** Retire the guide and remember that it ran. */
  onDismiss: () => void
}

/** The one-time bubble: one sentence, one way out, anchored to a tab. */
export function TabHoverGuide({ t, target, onDismiss }: TabHoverGuideProps): ReactNode {
  return h(
    'div',
    {
      className: css.tabHover + ' ' + css.tabHoverGuide,
      role: 'status',
      'data-tab-hover-guide': target.key,
      style: { left: target.x + 'px', top: target.top + 'px' }
    },
    h('span', { className: css.tabHoverGuideText }, t('tabHoverGuide')),
    h(Button, { variant: 'ghost', size: 'sm', className: css.tabHoverButton, onClick: onDismiss }, t('tabHoverGuideDismiss'))
  )
}
