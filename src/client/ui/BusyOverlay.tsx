import { createElement as h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconLoadingOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { busySnapshot, operationTarget, subscribeBusy } from './busy-operation.js'
import type { Translate } from '../index.js'
import css from './busy-overlay.module.css'

export const BUSY_SHOW_DELAY_MS = 200
export const BUSY_LONG_RUNNING_MS = 20_000

/** Mount once per client. A body-level host covers portaled dialogs without inheriting their inert state. */
export function BusyOverlay({ t }: { t: Translate }): ReactNode {
  const tasks = useSyncExternalStore(subscribeBusy, busySnapshot, busySnapshot)
  const latest = [...tasks].reverse()
  const target = latest.find(task => task.blocking && task.target?.isConnected)?.target ?? latest.find(task => task.target?.isConnected)?.target ?? (tasks.length ? operationTarget() : null)
  const [visible, setVisible] = useState(false)
  const [slow, setSlow] = useState(false)
  const active = tasks.length > 0
  const blocking = tasks.some(task => task.blocking)

  useLayoutEffect(() => {
    if (!active) return
    const show = setTimeout(() => setVisible(true), BUSY_SHOW_DELAY_MS)
    const warn = setTimeout(() => setSlow(true), BUSY_LONG_RUNNING_MS)
    return () => {
      clearTimeout(show)
      clearTimeout(warn)
      setVisible(false)
      setSlow(false)
    }
  }, [active])

  return active && target ? h(ActiveOverlay, { target, t, visible, slow, blocking }) : null
}

function ActiveOverlay({ target, t, visible, slow, blocking }: { target: HTMLElement; t: Translate; visible: boolean; slow: boolean; blocking: boolean }): ReactNode {
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
    if (!blocking) return
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
  }, [target, blocking])

  useLayoutEffect(() => {
    if (!visible) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inertBefore = target.hasAttribute('inert')
    const busyBefore = target.getAttribute('aria-busy')
    if (blocking) target.setAttribute('inert', '')
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
    if (blocking) {
      window.addEventListener('focusin', trapFocus, true)
      ref.current?.focus({ preventScroll: true })
    }
    update()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('focusin', trapFocus, true)
      if (blocking && !inertBefore) target.removeAttribute('inert')
      if (busyBefore === null) target.removeAttribute('aria-busy')
      else target.setAttribute('aria-busy', busyBefore)
      if (blocking && previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true })
    }
  }, [target, visible, blocking])

  if (!visible) return null
  return h(
    'div',
    {
      ref,
      className: css.overlay,
      tabIndex: blocking ? -1 : undefined,
      'data-operation-overlay': true,
      'data-visible': true,
      'data-blocking': blocking,
      role: 'status',
      'aria-live': 'polite',
      'aria-label': t('panelWorking'),
      style: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: getComputedStyle(target).borderRadius },
      onKeyDown: (event: { preventDefault(): void; stopPropagation(): void }) => {
        if (!blocking) return
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
