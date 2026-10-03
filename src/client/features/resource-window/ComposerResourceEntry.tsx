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
        'span',
        { className: css.entryGrid, 'aria-hidden': true },
        h('span', { className: css.entryGridCell }),
        h('span', { className: css.entryGridCell }),
        h('span', { className: css.entryGridCell }),
        h('span', { className: css.entryGridCell })
      ),
      filtered ? h('span', { className: css.entryDot, 'aria-hidden': true }) : null
    ),
    h(ResourceWindow, { t, open, onClose: () => setOpen(false) })
  )
}
