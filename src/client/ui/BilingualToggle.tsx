/**
 * The one button that flips a panel between translated and authored text.
 *
 * The switch is display-only state owned by the panel that renders the rows, so
 * one click re-renders every description under it. It is deliberately
 * not persisted and never enters the URL: the host's auto-translate setting
 * stays the only durable translation preference, and a reader who opens the
 * panel tomorrow sees the interface language again.
 *
 * The control exists only while auto-translate is on: with the feature off
 * there is no translation to flip away from, and a button that swaps a text for
 * itself reads as broken. The glyph is the host's own globe — the published set
 * has no dedicated language mark, and the globe is the nearest cross-language
 * reading the platform offers.
 * @module client/ui/BilingualToggle
 */
import { createElement as h, type ReactNode } from 'react'
import { IconGlobeOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'
import { useTranslationEnabled } from './translation-enabled.js'
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
 * The label names the view a click leads to — the same convention the grid/list
 * switch follows — while `aria-pressed` reports the view in force.
 * @param props - the translator, the view in force, and the flipper.
 * @returns the control, or null while auto-translate is off.
 */
export function BilingualToggle({ t, showOriginal, onToggle }: BilingualToggleProps): ReactNode {
  // Subscribed rather than read once, so turning the setting on brings the
  // control back without a reload.
  const enabled = useTranslationEnabled()
  if (!enabled) return null
  const label = t(showOriginal ? 'translationShowTranslated' : 'translationShowOriginal')
  return h(
    'button',
    {
      type: 'button',
      className: `${rc.iconBtn} ${rc.translateToggle}`,
      title: label,
      'aria-label': label,
      // Pressed means the translation is what shows: the switch reads as on
      // while the translated text is in force, and off while the original is.
      'aria-pressed': !showOriginal,
      'data-bilingual-toggle': true,
      onClick: onToggle
    },
    h(IconGlobeOutlineMedium)
  )
}
