// @vitest-environment jsdom
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ICON_MEDIUM_STROKE } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentExtensionIcon } from '../../../packages/market-ui/src/ui/AgentExtensionIcon.js'

it('renders the ring with one filled and one hollow node in one inherited color', () => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = renderToStaticMarkup(h(AgentExtensionIcon))
  const icon = wrapper.querySelector('svg')!
  expect(icon.getAttribute('viewBox')).toBe('0 0 16 16')
  expect(icon.getAttribute('stroke')).toBe('currentColor')
  expect(icon.getAttribute('fill')).toBe('none')
  expect(icon.getAttribute('aria-hidden')).toBe('true')
  expect(icon.getAttribute('width')).toBe('16')
  // Four arc segments form the ring; the dots sit on it, not inside it.
  expect(icon.querySelectorAll('path')).toHaveLength(4)
  const circles = [...icon.querySelectorAll('circle')]
  expect(circles).toHaveLength(2)
  const filled = circles.find(node => node.getAttribute('fill') === 'currentColor')
  const hollow = circles.find(node => node.getAttribute('fill') !== 'currentColor')
  // The nodes sit on the ring's horizontal extremes, inside a 77% width band.
  expect(filled?.getAttribute('cx')).toBe('3.4')
  expect(hollow?.getAttribute('cx')).toBe('12.6')
  // Both dots share the ring's vertical center line.
  expect(filled?.getAttribute('cy')).toBe('8')
  expect(hollow?.getAttribute('cy')).toBe('8')
  // The hollow node's outline is lighter than the ring, so its opening stays visible at 16px.
  expect(hollow?.getAttribute('stroke-width')).toBe('0.9')
  // The host's 16-unit grid carries the medium stroke unchanged, like the permission glyphs.
  expect(icon.getAttribute('stroke-width')).toBe(String(ICON_MEDIUM_STROKE))
  // Each arc starts at least one unit clear of its node's edge, so the node and the
  // ring read as separate marks at 1:1 instead of fusing into one blob.
  const centers = circles.map(node => ({ x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) }))
  const radius = Number(filled?.getAttribute('r'))
  for (const path of icon.querySelectorAll('path')) {
    const [x, y] = (path.getAttribute('d') ?? '').slice(1).split('A')[0]!.trim().split(/\s+/).map(Number)
    const nearest = Math.min(...centers.map(center => Math.hypot(center.x - x!, center.y - y!)))
    expect(nearest).toBeGreaterThanOrEqual(radius + ICON_MEDIUM_STROKE / 2 + 1)
  }
})
it('accepts native placement and accessible naming without duplicate ids', () => {
  const markup = renderToStaticMarkup(h(AgentExtensionIcon, { size: 20, className: 'slot-icon', role: 'img', 'aria-hidden': false, 'aria-label': 'Agent extensions' }))
  expect(markup).toContain('width="20"')
  expect(markup).toContain('class="slot-icon"')
  expect(markup).toContain('aria-label="Agent extensions"')
  expect(markup).not.toContain('id=')
})
