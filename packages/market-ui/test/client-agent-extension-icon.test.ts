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
  // The nodes sit on the ring's horizontal extremes, inside a 74% width band so the
  // glyph keeps the shield's breathing room in the 14px composer seat.
  expect(filled?.getAttribute('cx')).toBe('3.6')
  expect(hollow?.getAttribute('cx')).toBe('12.4')
  // Both dots share the ring's vertical center line.
  expect(filled?.getAttribute('cy')).toBe('8')
  expect(hollow?.getAttribute('cy')).toBe('8')
  // The host's 16-unit grid carries the medium stroke unchanged, like the permission glyphs.
  expect(icon.getAttribute('stroke-width')).toBe(String(ICON_MEDIUM_STROKE))
})
it('accepts native placement and accessible naming without duplicate ids', () => {
  const markup = renderToStaticMarkup(h(AgentExtensionIcon, { size: 20, className: 'slot-icon', role: 'img', 'aria-hidden': false, 'aria-label': 'Agent extensions' }))
  expect(markup).toContain('width="20"')
  expect(markup).toContain('class="slot-icon"')
  expect(markup).toContain('aria-label="Agent extensions"')
  expect(markup).not.toContain('id=')
})
