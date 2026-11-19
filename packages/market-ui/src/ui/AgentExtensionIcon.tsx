import { ICON_MEDIUM_STROKE } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement as h, type ReactNode, type SVGProps } from 'react'

/** This artwork draws on a 28-unit grid; the host icons draw on 16. Match their rendered weight. */
const STROKE = (ICON_MEDIUM_STROKE * 28) / 16

/**
 * Two nodes joined by an arc: a filled dot and a hollow dot sit on a circular
 * ring, top and bottom arcs connecting them. The agent is the solid node, the
 * docked extension the hollow one, the ring the session that binds both.
 */
export function AgentExtensionIcon({ size = 16, style, ...props }: SVGProps<SVGSVGElement> & { size?: number }): ReactNode {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 28 28',
      fill: 'none',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      'aria-hidden': true,
      ...props,
      style: { flexShrink: 0, ...style }
    },
    h('path', { d: 'M7 9A9.5 9.5 0 0 1 14 4.5', strokeWidth: STROKE }),
    h('path', { d: 'M7 19A9.5 9.5 0 0 0 14 23.5', strokeWidth: STROKE }),
    h('path', { d: 'M21 9A9.5 9.5 0 0 0 14 4.5', strokeWidth: STROKE }),
    h('path', { d: 'M21 19A9.5 9.5 0 0 1 14 23.5', strokeWidth: STROKE }),
    h('circle', { cx: 4.2, cy: 14, r: 2.6, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 23.8, cy: 14, r: 2.6, strokeWidth: STROKE })
  )
}
