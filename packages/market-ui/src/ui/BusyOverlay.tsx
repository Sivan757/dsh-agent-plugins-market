import { createElement as h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconLoadingOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { busySnapshot, operationTarget, subscribeBusy } from './busy-operation.js'
import type { Translate } from '../i18n.js'
import css from './busy-overlay.module.css'

export const BUSY_SHOW_DELAY_MS = 200
export const BUSY_LONG_RUNNING_MS = 20_000

/** Mount once per client. A body-level host covers portaled dialogs without inheriting their inert state. */
export function BusyOverlay({ t }: { t: Translate }): ReactNode {
  const tasks = useSyncExternalStore(subscribeBusy, busySnapshot, busySnapshot)
  const latest = [...tasks].reverse()
  const blocking = tasks.some(task => task.blocking)
  // Only a blocking lease earns an overlay. A read reports itself where it is
  // read — the panel shows its own loading line and keeps its controls usable —
  // so a second floating card would only repeat that, over content the user can
  // still work with.
  const target = blocking ? (latest.find(task => task.blocking && task.target?.isConnected)?.target ?? operationTarget()) : null
  const [visible, setVisible] = useState(false)
  const [slow, setSlow] = useState(false)
  const overlay = target !== null

  useLayoutEffect(() => {
    if (!overlay) return
    const show = setTimeout(() => setVisible(true), BUSY_SHOW_DELAY_MS)
    const warn = setTimeout(() => setSlow(true), BUSY_LONG_RUNNING_MS)
    return () => {
      clearTimeout(show)
      clearTimeout(warn)
      setVisible(false)
      setSlow(false)
    }
  }, [overlay])

  return overlay && target !== null ? h(ActiveOverlay, { target, t, visible, slow }) : null
}

function ActiveOverlay({ target, t, visible, slow }: { target: HTMLElement; t: Translate; visible: boolean; slow: boolean }): ReactNode {
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
    const scope = target.closest('[role="presentation"]') ?? target
    const stop = (event: Event): void => {
      if (ref.current?.contains(event.target as Node)) return
      // Include the modal backdrop: otherwise a click outside the dialog can close an active save.
      if (event instanceof KeyboardEvent || scope.contains(event.target as Node)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    for (const event of ['pointerdown', 'click', 'keydown', 'submit']) window.addEventListener(event, stop, true)
    return () => {
      for (const event of ['pointerdown', 'click', 'keydown', 'submit']) window.removeEventListener(event, stop, true)
    }
  }, [target])

  useLayoutEffect(() => {
    if (!visible) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inertBefore = target.hasAttribute('inert')
    const busyBefore = target.getAttribute('aria-busy')
    target.setAttribute('inert', '')
    target.setAttribute('aria-busy', 'true')
    const scope = target.closest('[role="presentation"]') ?? target
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
    window.addEventListener('focusin', trapFocus, true)
    ref.current?.focus({ preventScroll: true })
    update()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('focusin', trapFocus, true)
      if (!inertBefore) target.removeAttribute('inert')
      if (busyBefore === null) target.removeAttribute('aria-busy')
      else target.setAttribute('aria-busy', busyBefore)
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true })
    }
  }, [target, visible])

  if (!visible) return null
  return h(
    'div',
    {
      ref,
      className: css.overlay,
      tabIndex: -1,
      'data-operation-overlay': true,
      'data-visible': true,
      role: 'status',
      'aria-live': 'polite',
      'aria-label': t('panelWorking'),
      style: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: getComputedStyle(target).borderRadius },
      onKeyDown: (event: { preventDefault(): void; stopPropagation(): void }) => {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    h(
      'div',
      { className: css.content },
      h('span', { className: css.spinner, 'aria-hidden': true }, h(IconLoadingOutlineMedium, { size: 28 })),
      h('strong', { className: css.label }, t('panelWorking')),
      h('div', { className: css.hintViewport }, h('p', { key: message, className: css.hint }, hints[message])),
      slow ? h('p', { className: css.warning, role: 'alert' }, t('busyLongRunning')) : null
    )
  )
}
