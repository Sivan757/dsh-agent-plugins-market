/**
 * Suggesting a selection, then deciding what to do with it.
 *
 * The modal asks one question and then shows the answer: a name, a reason, and the rows it
 * selected. Applying is a separate press, and what it does belongs to the caller — the preset
 * manager creates a preset, the market narrows its list so the reader installs through the
 * confirmation each card already has. A suggestion never changes anything by itself.
 *
 * It lives in the shared layer because two features ask the same question about different
 * worlds, and a feature may not import its sibling.
 *
 * @module client/ui/AiSelectionModal
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { requestAiPreset } from '../api.js'
import type { AiPresetCandidate, AiPresetSuggestion } from '../../../market-contracts/src/contracts/ai-draft.js'
import { clientErrorMessage } from './error-message.js'
import type { Translate } from '../i18n.js'
import css from './form.module.css'

/** What the modal needs. */
export interface AiSelectionModalProps {
  t: Translate
  /**
   * What the suggestion selects.
   *
   * `preset` creates a preset from the rows on screen; `install` recommends catalogue suites
   * for a stated purpose, and applying it narrows the market list to them so the existing
   * install confirmation stays the only way anything gets installed.
   */
  mode?: 'preset' | 'install'
  /**
   * The rows a suggestion may select, in the order the manager shows them.
   *
   * Absent in `install` mode: the server reads its own catalogue, so the answer is validated
   * against the catalogue rather than against what a browser happened to render.
   */
  candidates?: readonly AiPresetCandidate[]
  /** How to name a selected row on screen; the caller owns the labels it shows. */
  resolveLabel?: (id: string) => string
  /** Applies the suggestion; the manager creates the preset and closes. */
  onApply: (suggestion: AiPresetSuggestion) => Promise<void>
  onClose: () => void
}

/** The language the suggestion should be written in, read from the dictionary in force. */
function suggestionLocale(t: Translate): 'zh' | 'en' {
  return String(t('localeProbeLang')).toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function AiSelectionModal(props: AiSelectionModalProps): ReactNode {
  const { t, candidates, resolveLabel, onApply, onClose, mode = 'preset' } = props
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [suggestion, setSuggestion] = useState<AiPresetSuggestion | undefined>(undefined)
  const labelOf = (id: string): string => resolveLabel?.(id) ?? candidates?.find(candidate => candidate.id === id)?.label ?? id
  const suggest = (): void => {
    if (intent.trim() === '' || busy) return
    setBusy(true)
    setError(undefined)
    requestAiPreset({
      intent,
      locale: suggestionLocale(t),
      purpose: mode,
      ...(mode === 'install' || candidates === undefined ? {} : { candidates })
    })
      .then(setSuggestion)
      .catch((caught: unknown) => {
        const code = typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
        setError(code === 'ai-provider-limited' ? t('aiDraftLimited') : clientErrorMessage(t, caught))
      })
      .finally(() => setBusy(false))
  }
  return h(
    Modal,
    {
      open: true,
      onClose,
      title: mode === 'install' ? t('aiSelectInstallTitle') : t('aiSelectTitle'),
      description: mode === 'install' ? t('aiSelectInstallHint') : t('aiSelectHint'),
      closeLabel: t('cancel'),
      footer: h(
        'div',
        { className: css.footer },
        error === undefined ? null : h('span', { className: css.footerError, role: 'alert' }, error),
        h('div', { className: css.grow }),
        h(Button, { variant: 'outline', onClick: onClose }, t('cancel')),
        suggestion === undefined
          ? h(Button, { variant: 'primary', disabled: busy || intent.trim() === '', onClick: suggest }, busy ? t('aiDraftBusy') : t('aiSelectGenerate'))
          : h(
              Button,
              {
                variant: 'primary',
                disabled: applying,
                onClick: () => {
                  setApplying(true)
                  void onApply(suggestion).finally(() => setApplying(false))
                }
              },
              mode === 'install' ? t('aiSelectInstallApply') : t('aiSelectApply')
            )
      )
    },
    h(
      'div',
      { className: css.field },
      h('input', {
        value: intent,
        disabled: busy,
        placeholder: t('aiSelectPlaceholder'),
        'aria-label': t(mode === 'install' ? 'aiSelectInstallTitle' : 'aiSelectTitle'),
        onChange: (event: { target: HTMLInputElement }) => {
          setIntent(event.target.value)
          // A new question invalidates the old answer: what is shown must be what would be created.
          setSuggestion(undefined)
        }
      })
    ),
    suggestion === undefined
      ? null
      : h(
          'div',
          { className: css.field },
          h(
            'span',
            null,
            t('aiSelectPreview', { name: suggestion.name, count: String(suggestion.enabledIds.length) }) +
              (suggestion.usage === undefined ? '' : ' · ' + t('aiDraftCost', { input: String(suggestion.usage.inputTokens), output: String(suggestion.usage.outputTokens) }))
          ),
          suggestion.reason === '' ? null : h('p', { className: css.aiNote }, suggestion.reason),
          h(
            'ul',
            { className: css.aiList },
            suggestion.enabledIds.map(id => h('li', { key: id }, labelOf(id)))
          )
        )
  )
}
