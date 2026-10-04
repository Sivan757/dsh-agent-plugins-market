/**
 * One clipped line's full text, shown on hover through the host tooltip.
 *
 * A native `title` waits on the platform's own timer, which made a truncated
 * name, path, or command read as having no hint at all. The host `Tooltip`
 * draws the platform's own bubble — `--dsw-alias-tooltip-bg` on the platform's
 * foreground, fixed-positioned so no card's clipping hides it — and places it
 * under the anchor after a short pause long enough to survive a pointer sweep
 * yet short enough to answer a real hover.
 *
 * It clones its child and chains its own hover and focus handlers onto it, so
 * the anchor's props are typed through {@link hintProps} to satisfy that
 * contract without a cast at every call site.
 * @module client/ui/hover-hint
 */
import { createElement as h, type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

/** An element the host tooltip accepts as its anchor: a plain span or button. */
export type HintAnchor = ReactElement<HTMLAttributes<HTMLElement> | ButtonHTMLAttributes<HTMLButtonElement>>

/** How long the pointer must rest on the anchor before its hint appears. */
const SHOW_DELAY_MS = 500

/**
 * Type one anchor's props as tooltip-compatible.
 *
 * @param props - the element's own attributes.
 * @returns the same attributes, unchanged.
 */
export function hintProps<P extends object>(props: P): P {
  return props
}

/**
 * Attach the clipped element's full text as a hover hint below it.
 *
 * @param label - the text the anchor clips.
 * @param anchor - the element that carries it, built with {@link hintProps}.
 * @returns the anchor with the host tooltip attached.
 */
export function hoverHint(label: string, anchor: HintAnchor): ReactNode {
  return h(Tooltip, { label, side: 'bottom', delayMs: SHOW_DELAY_MS, children: anchor })
}
