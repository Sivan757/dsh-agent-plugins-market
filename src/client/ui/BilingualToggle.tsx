/**
 * The one button that flips a panel between translated and authored text.
 *
 * The switch is display-only state owned by the panel that renders the rows, so
 * one click re-reads every name and description under it. It is deliberately
 * not persisted and never enters the URL: the host's auto-translate setting
 * stays the only durable translation preference, and a reader who opens the
 * panel tomorrow sees the interface language again.
 * @module client/ui/BilingualToggle
 */
import { createElement as h, type ReactNode } from 'react'
import { IconGlobeOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'
import rc from './resource-card.module.css'

export interface BilingualToggleProps {
  t: Translate
  /** True while the authored text shows; false while the translation shows. */
  showOriginal: boolean
  /** Flip the panel-wide view. */
  onToggle: () => void
}

/**
 * The flat icon button that switches one panel between the two texts.
 *
 * The globe is the host's own cross-language mark: the published icon set has
 * no translate glyph, and a self-drawn one is not worth a reuse deviation. The
 * label names the view a click leads to — the same convention the grid/list
 * switch follows — while `aria-pressed` reports the view in force.
 */
export function BilingualToggle({ t, showOriginal, onToggle }: BilingualToggleProps): ReactNode {
  const label = t(showOriginal ? 'translationShowTranslated' : 'translationShowOriginal')
  return h(
    'button',
    {
      type: 'button',
      className: `${rc.iconBtn} ${rc.translateToggle}`,
      title: label,
      'aria-label': label,
      'aria-pressed': showOriginal,
      'data-bilingual-toggle': true,
      onClick: onToggle
    },
    h(IconGlobeOutlineMedium)
  )
}
