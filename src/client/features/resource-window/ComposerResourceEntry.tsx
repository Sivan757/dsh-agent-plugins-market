/**
 * The composer's project-resource entry button.
 *
 * One four-square glyph (the prototype's plugin grid) with a filter dot that
 * lights while this workspace filters anything off. Clicking opens the window;
 * the button keeps the flat ghost geometry the composer's other tool buttons
 * use, styled only through platform tokens.
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { fetchResourceWindow } from './resource-window-resource.js'
import { ResourceWindow } from './ResourceWindow.js'
import type { ResourceTranslate } from './ResourceWindow.js'
import css from './resource-window.module.css'

export interface ComposerResourceEntryProps {
  t: ResourceTranslate
}

export function ComposerResourceEntry({ t }: ComposerResourceEntryProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [filtered, setFiltered] = useState(false)

  // The dot reflects live state: any denied entry or off surface in this
  // workspace lights it. A failed read keeps the last known state.
  useEffect(() => {
    let alive = true
    fetchResourceWindow()
      .then(window => {
        if (!alive) return
        const anyOff = window.entries.some(entry => !entry.enabled)
        setFiltered(anyOff)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open])

  return h(
    'span',
    { className: css.entryWrap },
    h(
      'button',
      {
        type: 'button',
        className: css.entryButton,
        'data-active': open ? 'true' : 'false',
        'aria-label': t('resourceWindowOpen'),
        'aria-haspopup': 'dialog',
        title: t('resourceWindowOpen'),
        onClick: () => setOpen(value => !value)
      },
      h(
        'svg',
        { className: css.entryGlyph, viewBox: '0 0 18 18', 'aria-hidden': true },
        h('rect', { x: 1.5, y: 1.5, width: 6, height: 6, rx: 1.5 }),
        h('rect', { x: 10.5, y: 1.5, width: 6, height: 6, rx: 1.5 }),
        h('rect', { x: 1.5, y: 10.5, width: 6, height: 6, rx: 1.5 }),
        h('rect', { x: 10.5, y: 10.5, width: 6, height: 6, rx: 1.5 })
      ),
      h('span', { className: css.entryPlus, 'aria-hidden': true }, '+'),
      filtered ? h('span', { className: css.entryDot, 'aria-hidden': true }) : null
    ),
    h(ResourceWindow, { t, open, onClose: () => setOpen(false) })
  )
}
