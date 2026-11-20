import { ICON_MEDIUM_STROKE } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement as h, type ReactNode, type SVGProps } from 'react'

/**
 * Two nodes joined by a ring: the agent is the solid node, the docked extension the
 * hollow one, the ring the session that binds both.
 *
 * Drawn on the host's 16-unit icon grid at the medium stroke, so it carries the same
 * rendered weight as the permission glyphs beside it: 1.14px at the composer's 14px
 * seat, 74% of the box wide (the shield's ratio), the nodes on the ring's horizontal
 * extremes, and no ink outside the 2.1–13.9 band.
 */
export function AgentExtensionIcon({ size = 16, style, ...props }: SVGProps<SVGSVGElement> & { size?: number }): ReactNode {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: ICON_MEDIUM_STROKE,
      strokeLinecap: 'round',
      'aria-hidden': true,
      ...props,
      style: { flexShrink: 0, ...style }
    },
    h('path', { d: 'M4.35 5.54A4.4 4.4 0 0 1 8 3.6' }),
    h('path', { d: 'M11.65 5.54A4.4 4.4 0 0 0 8 3.6' }),
    h('path', { d: 'M4.35 10.46A4.4 4.4 0 0 0 8 12.4' }),
    h('path', { d: 'M11.65 10.46A4.4 4.4 0 0 1 8 12.4' }),
    h('circle', { cx: 3.6, cy: 8, r: 1.5, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12.4, cy: 8, r: 1.5 })
  )
}
