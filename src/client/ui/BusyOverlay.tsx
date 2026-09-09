import { createElement as h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { busySnapshot, operationTarget, subscribeBusy } from './busy-operation.js'
import type { Translate } from '../index.js'
import css from './busy-overlay.module.css'

export const BUSY_SHOW_DELAY_MS = 200
export const BUSY_MIN_VISIBLE_MS = 400
export const BUSY_SETTLE_MS = 100

/** Mount once per client. A body-level host covers portaled dialogs without inheriting their inert state. */
export function BusyOverlay({ t }: { t: Translate }): ReactNode {
  const tasks = useSyncExternalStore(subscribeBusy, busySnapshot, busySnapshot)
  const target = [...tasks].reverse().find(task => task.target?.isConnected)?.target ?? (tasks.length ? operationTarget() : null)
  const [heldTarget, setHeldTarget] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)
  const startedAt = useRef<number | null>(null)
  const shownAt = useRef<number | null>(null)
  const active = tasks.length > 0

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (active && target) {
      setHeldTarget(target)
      startedAt.current ??= Date.now()
      if (shownAt.current === null) {
        timer = setTimeout(
          () => {
            shownAt.current = Date.now()
            setVisible(true)
          },
          Math.max(0, BUSY_SHOW_DELAY_MS - (Date.now() - startedAt.current))
        )
      }
    } else {
      const clear = (): void => {
        startedAt.current = null
        shownAt.current = null
        setVisible(false)
        setHeldTarget(null)
      }
      if (shownAt.current === null) clear()
      else timer = setTimeout(clear, Math.max(BUSY_SETTLE_MS, BUSY_MIN_VISIBLE_MS - (Date.now() - shownAt.current)))
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [active, target])

  const displayedTarget = target ?? (heldTarget?.isConnected ? heldTarget : null)
  return displayedTarget && (active || visible) ? h(ActiveOverlay, { target: displayedTarget, t, visible }) : null
}

function ActiveOverlay({ target, t, visible }: { target: HTMLElement; t: Translate; visible: boolean }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState(() => target.getBoundingClientRect())
  const [message, setMessage] = useState(0)
  const hints = [t('busyHintProcessing'), t('busyHintRefresh'), t('busyHintWaiting')]

  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => setMessage(value => (value + 1) % hints.length), 3200)
    return () => clearInterval(timer)
  }, [hints.length, visible])

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inertBefore = target.hasAttribute('inert')
    const busyBefore = target.getAttribute('aria-busy')
    target.setAttribute('inert', '')
    target.setAttribute('aria-busy', 'true')
    const scope = target.closest('[role="presentation"]') ?? target
    const stop = (event: Event): void => {
      if (ref.current?.contains(event.target as Node)) return
      // Include the modal backdrop: otherwise a click outside the dialog can close an active save.
      if (event instanceof KeyboardEvent || scope.contains(event.target as Node)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    const trapFocus = (event: FocusEvent): void => {
      if (scope.contains(event.target as Node)) ref.current?.focus({ preventScroll: true })
    }
    const update = (): void => {
      const next = target.getBoundingClientRect()
      setRect(previous => (previous.top === next.top && previous.left === next.left && previous.width === next.width && previous.height === next.height ? previous : next))
    }
    // ResizeObserver does not observe transform animations on the host dialog.
    let frame = 0
    const follow = (): void => {
      update()
      frame = requestAnimationFrame(follow)
    }
    if (typeof requestAnimationFrame !== 'undefined') frame = requestAnimationFrame(follow)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(target)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    for (const event of ['pointerdown', 'click', 'keydown', 'submit']) window.addEventListener(event, stop, true)
    window.addEventListener('focusin', trapFocus, true)
    ref.current?.focus({ preventScroll: true })
    update()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      for (const event of ['pointerdown', 'click', 'keydown', 'submit']) window.removeEventListener(event, stop, true)
      window.removeEventListener('focusin', trapFocus, true)
      if (!inertBefore) target.removeAttribute('inert')
      if (busyBefore === null) target.removeAttribute('aria-busy')
      else target.setAttribute('aria-busy', busyBefore)
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true })
    }
  }, [target])

  return h(
    'div',
    {
      ref,
      className: css.overlay,
      tabIndex: -1,
      'data-operation-overlay': true,
      'data-visible': visible,
      role: 'status',
      'aria-live': 'polite',
      'aria-label': t('panelWorking'),
      style: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: getComputedStyle(target).borderRadius },
      onKeyDown: (event: { preventDefault(): void; stopPropagation(): void }) => {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    visible
      ? h(
          'div',
          { className: css.content },
          h('span', { className: css.spinner, 'aria-hidden': true }, h(IconLoadingOutline16, { size: 28 })),
          h('strong', { className: css.label }, t('panelWorking')),
          h('div', { className: css.hintViewport }, h('p', { key: message, className: css.hint }, hints[message]))
        )
      : null
  )
}
