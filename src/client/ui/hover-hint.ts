/**
 * One clipped line's full text, shown on hover through the host tooltip.
 *
 * The host `Tooltip` shows with no delay, where a native `title` waits on the
 * platform's own timer — long enough that a truncated name, path, or command
 * reads as having no hint at all. It clones its child and chains its own hover
 * and focus handlers onto it, so the anchor's props are typed through
 * {@link hintProps} to satisfy that contract without a cast at every call site.
 * @module client/ui/hover-hint
 */
import { createElement as h, type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

/** An element the host tooltip accepts as its anchor: a plain span or button. */
export type HintAnchor = ReactElement<HTMLAttributes<HTMLElement> | ButtonHTMLAttributes<HTMLButtonElement>>

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
 * Attach the clipped element's full text as an instant hover hint.
 *
 * @param label - the text the anchor clips.
 * @param anchor - the element that carries it, built with {@link hintProps}.
 * @returns the anchor with the host tooltip attached.
 */
export function hoverHint(label: string, anchor: HintAnchor): ReactNode {
  return h(Tooltip, { label, children: anchor })
}
