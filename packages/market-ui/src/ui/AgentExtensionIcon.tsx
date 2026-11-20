import { ICON_MEDIUM_STROKE } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement as h, type ReactNode, type SVGProps } from 'react'

/**
 * Two nodes joined by a ring: the agent is the solid node, the docked extension the
 * hollow one, the ring the session that binds both.
 *
 * Drawn on the host's 16-unit icon grid at the medium stroke and rendered at the
 * full 16px, so the glyph holds its own in a row of 14px host glyphs: the ring
 * spans 77% of the box with its nodes on the horizontal extremes, and each node
 * stands a full unit clear of the arc ends, so the two read as separate marks at
 * 1:1 rather than fusing into one blob.
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
    h('path', { d: 'M4.533 4.977A4.6 4.6 0 0 1 8 3.4' }),
    h('path', { d: 'M11.467 4.977A4.6 4.6 0 0 0 8 3.4' }),
    h('path', { d: 'M4.533 11.023A4.6 4.6 0 0 0 8 12.6' }),
    h('path', { d: 'M11.467 11.023A4.6 4.6 0 0 1 8 12.6' }),
    h('circle', { cx: 3.4, cy: 8, r: 1.55, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12.6, cy: 8, r: 1.55 })
  )
}
