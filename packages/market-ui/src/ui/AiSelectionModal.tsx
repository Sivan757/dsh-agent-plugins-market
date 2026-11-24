/**
 * Suggesting a selection, then deciding what to do with it.
 *
 * The modal asks one question and then shows the answer: a name, a reason, and
 * the rows it selected — each one with the line that describes it, and each one
 * the reader can untick. Applying is a separate press over the rows still
 * ticked, and what it does belongs to the caller: the preset manager creates a
 * preset, the market narrows its list so the reader installs through the
 * confirmation each card already has. A suggestion never changes anything by
 * itself.
 *
 * It lives in the shared layer because two features ask the same question about
 * different worlds, and a feature may not import its sibling.
 *
 * @module client/ui/AiSelectionModal
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { requestAiPreset } from '../api.js'
import { FormDialog } from './DetailModal.js'
import { CardActions, CardBody, CardIdentity, ResourceCard, ResourceCollection } from './ResourceCard.js'
import type { AiPresetCandidate, AiPresetSuggestion } from '../../../market-contracts/src/contracts/ai-draft.js'
import { aiFailureText } from './error-message.js'
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
   * The rows a suggestion may select, in the order the caller shows them.
   *
   * Absent in `install` mode: the server reads its own catalogue, so the answer is validated
   * against the catalogue rather than against what a browser happened to render. The rows are
   * still passed for the reader to judge, with the line that describes each one.
   */
  candidates?: readonly AiPresetCandidate[]
  /**
   * Applies the suggestion over the rows the reader kept ticked; the manager
   * creates the preset and closes, the market narrows its list.
   */
  onApply: (suggestion: AiPresetSuggestion, ids: readonly string[]) => Promise<void>
  onClose: () => void
}

/** The language the suggestion should be written in, read from the dictionary in force. */
function suggestionLocale(t: Translate): 'zh' | 'en' {
  return String(t('localeProbeLang')).toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function AiSelectionModal(props: AiSelectionModalProps): ReactNode {
  const { t, candidates, onApply, onClose, mode = 'preset' } = props
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [suggestion, setSuggestion] = useState<AiPresetSuggestion | undefined>(undefined)
  // Every row the answer named starts ticked: the suggestion is the model's
  // proposal, and dropping one is the reader's own decision.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const candidateOf = (id: string): AiPresetCandidate | undefined => candidates?.find(candidate => candidate.id === id)
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
      .then(answer => {
        setSuggestion(answer)
        setChosen(new Set(answer.enabledIds))
      })
      .catch((caught: unknown) => setError(aiFailureText(t, caught)))
      .finally(() => setBusy(false))
  }
  const apply = (answer: AiPresetSuggestion): void => {
    setApplying(true)
    void onApply(answer, [...chosen]).finally(() => setApplying(false))
  }
  const toggleChoice = (id: string): void => {
    setChosen(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return h(
    FormDialog,
    {
      onClose,
      title: mode === 'install' ? t('aiSelectInstallTitle') : t('aiSelectTitle'),
      description: mode === 'install' ? t('aiSelectInstallHint') : t('aiSelectHint'),
      closeLabel: t('cancel'),
      ...(error === undefined ? {} : { alert: error }),
      // An AI action leads the row, ahead of the human ones: it is the reason
      // the dialog exists, and every later dialog that offers one keeps it there.
      actions: [
        suggestion === undefined
          ? h(Button, { key: 'suggest', variant: 'primary', disabled: busy || intent.trim() === '', onClick: suggest }, busy ? t('aiDraftBusy') : t('aiSelectGenerate'))
          : h(
              Button,
              { key: 'apply', variant: 'primary', disabled: applying || chosen.size === 0, onClick: () => apply(suggestion) },
              t(mode === 'install' ? 'aiSelectInstallApply' : 'aiSelectApply')
            ),
        h(Button, { key: 'cancel', variant: 'outline', onClick: onClose }, t('cancel'))
      ]
    },
    h(
      'label',
      { className: css.field },
      h('span', null, t('aiSelectIntentLabel')),
      h('input', {
        value: intent,
        disabled: busy,
        placeholder: t('aiSelectPlaceholder'),
        'aria-label': t('aiSelectIntentLabel'),
        onChange: (event: { target: HTMLInputElement }) => {
          setIntent(event.target.value)
          // A new question invalidates the old answer: what is shown must be what would be created.
          setSuggestion(undefined)
          setChosen(new Set())
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
            t('aiSelectPreview', { name: suggestion.name, count: String(chosen.size) }) +
              (suggestion.usage === undefined ? '' : ' · ' + t('aiDraftCost', { input: String(suggestion.usage.inputTokens), output: String(suggestion.usage.outputTokens) }))
          ),
          suggestion.reason === '' ? null : h('p', { className: css.aiNote }, suggestion.reason),
          // The rows keep the one card anatomy every list in the plugin uses: a
          // name, the line that describes it, and one control in the action
          // cluster. The control is a tick rather than a switch because a
          // suggestion is a choice, not an enable.
          h(
            ResourceCollection,
            { view: 'list', className: css.aiChoiceList },
            suggestion.enabledIds.map((id, index) => {
              const candidate = candidateOf(id)
              const label = candidate?.label ?? id
              const checked = chosen.has(id)
              return h(
                ResourceCard,
                {
                  key: id,
                  state: checked ? 'active' : 'absent',
                  'data-resource-id': id,
                  position: index + 1,
                  count: suggestion.enabledIds.length,
                  onClick: () => toggleChoice(id)
                },
                h(CardIdentity, { text: label }),
                candidate?.description === undefined || candidate.description === ''
                  ? null
                  : h(CardBody, null, h('span', { className: css.aiChoiceDetail }, candidate.description)),
                h(
                  CardActions,
                  null,
                  h(
                    'label',
                    { className: css.aiCheck, onClick: (event: { stopPropagation(): void }) => event.stopPropagation() },
                    h('input', {
                      type: 'checkbox',
                      checked,
                      'aria-label': label,
                      onChange: () => toggleChoice(id)
                    })
                  )
                )
              )
            })
          )
        )
  )
}
