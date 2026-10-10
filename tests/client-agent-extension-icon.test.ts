// @vitest-environment jsdom
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { AgentExtensionIcon } from '../packages/market-ui/src/ui/AgentExtensionIcon.js'

it('renders the ring with one filled and one hollow node in one inherited color', () => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = renderToStaticMarkup(h(AgentExtensionIcon))
  const icon = wrapper.querySelector('svg')!
  expect(icon.getAttribute('viewBox')).toBe('0 0 28 28')
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
  expect(filled?.getAttribute('cx')).toBe('4.2')
  expect(hollow?.getAttribute('cx')).toBe('23.8')
  // Both dots share the ring's vertical center line.
  expect(filled?.getAttribute('cy')).toBe('14')
  expect(hollow?.getAttribute('cy')).toBe('14')
  expect(hollow?.getAttribute('stroke-width')).toBe('1.5')
})
it('accepts native placement and accessible naming without duplicate ids', () => {
  const markup = renderToStaticMarkup(h(AgentExtensionIcon, { size: 20, className: 'slot-icon', role: 'img', 'aria-hidden': false, 'aria-label': 'Agent extensions' }))
  expect(markup).toContain('width="20"')
  expect(markup).toContain('class="slot-icon"')
  expect(markup).toContain('aria-label="Agent extensions"')
  expect(markup).not.toContain('id=')
})
