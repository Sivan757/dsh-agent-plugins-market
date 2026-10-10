/**
 * The composer's project-resource entry button.
 *
 * The prototype's plugin-entry glyph: a 2x2 grid of filled rounded cells (the
 * two trailing cells dimmed) with a filter dot that lights while this
 * workspace filters anything off. Clicking opens the window; the button keeps
 * the flat ghost geometry the composer's other tool buttons use, styled only
 * through platform tokens.
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

  // The dot reflects live state: any denied entry in this workspace lights
  // it. A failed read keeps the last known state.
  useEffect(() => {
    let alive = true
    fetchResourceWindow()
      .then(window => {
        if (!alive) return
        setFiltered(window.entries.some(entry => !entry.enabled))
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
      // The prototype's .plugin-entry .grid: four 8px cells, the b/c pair dimmed.
      h(
        'span',
        { className: css.entryGrid, 'aria-hidden': true },
        h('span', { className: css.entryCellA }),
        h('span', { className: css.entryCellB }),
        h('span', { className: css.entryCellC }),
        h('span', { className: css.entryCellD })
      ),
      filtered ? h('span', { className: css.entryDot, 'aria-hidden': true }) : null
    ),
    h(ResourceWindow, { t, open, onClose: () => setOpen(false) })
  )
}
