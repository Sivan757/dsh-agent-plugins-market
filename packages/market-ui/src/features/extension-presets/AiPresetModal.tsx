/**
 * Suggesting a preset, then deciding whether to keep it.
 *
 * The modal asks one question and then shows what the answer would create: a name, a reason,
 * and the rows it selected. Applying is a separate press, and it goes through the same create
 * path the manager already uses — so a suggestion is never a preset until a person says so.
 *
 * @module features/extension-presets/AiPresetModal
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { requestAiPreset } from '../../api.js'
import type { AiPresetCandidate, AiPresetSuggestion } from '../../../../market-contracts/src/contracts/ai-draft.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import type { ExtensionTranslate } from './types.js'
import css from '../../ui/form.module.css'

/** What the modal needs. */
export interface AiPresetModalProps {
  t: ExtensionTranslate
  /** The rows a suggestion may select, in the order the manager shows them. */
  candidates: readonly AiPresetCandidate[]
  /** Applies the suggestion; the manager creates the preset and closes. */
  onApply: (suggestion: AiPresetSuggestion) => Promise<void>
  onClose: () => void
}

/** The language the suggestion should be written in, read from the dictionary in force. */
function suggestionLocale(t: ExtensionTranslate): 'zh' | 'en' {
  return String(t('localeProbeLang')).toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function AiPresetModal(props: AiPresetModalProps): ReactNode {
  const { t, candidates, onApply, onClose } = props
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [suggestion, setSuggestion] = useState<AiPresetSuggestion | undefined>(undefined)
  const labelOf = (id: string): string => candidates.find(candidate => candidate.id === id)?.label ?? id
  const suggest = (): void => {
    if (intent.trim() === '' || busy) return
    setBusy(true)
    setError(undefined)
    requestAiPreset({ intent, candidates, locale: suggestionLocale(t) })
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
      title: t('epSuggestTitle'),
      description: t('epSuggestHint'),
      closeLabel: t('cancel'),
      footer: h(
        'div',
        { className: css.footer },
        error === undefined ? null : h('span', { className: css.footerError, role: 'alert' }, error),
        h('div', { className: css.grow }),
        h(Button, { variant: 'outline', onClick: onClose }, t('cancel')),
        suggestion === undefined
          ? h(Button, { variant: 'primary', disabled: busy || intent.trim() === '', onClick: suggest }, busy ? t('aiDraftBusy') : t('epSuggestGenerate'))
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
              t('epSuggestApply')
            )
      )
    },
    h(
      'div',
      { className: css.field },
      h('input', {
        value: intent,
        disabled: busy,
        placeholder: t('epSuggestPlaceholder'),
        'aria-label': t('epSuggestTitle'),
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
          h('span', null, t('epSuggestPreview', { name: suggestion.name, count: String(suggestion.enabledIds.length) })),
          suggestion.reason === '' ? null : h('p', { className: css.aiNote }, suggestion.reason),
          h(
            'ul',
            { className: css.aiList },
            suggestion.enabledIds.map(id => h('li', { key: id }, labelOf(id)))
          )
        )
  )
}
