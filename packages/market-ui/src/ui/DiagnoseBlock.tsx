/**
 * Asking the model to explain one failed service, without changing it.
 *
 * The block is a button and an answer. It sits inside a detail dialog, next to the facts the
 * panel established, because that is where a reader decides what to do next. The answer is
 * text: nothing here retries, restarts, edits or installs, so an explanation that is wrong
 * costs a reading rather than a working setup.
 *
 * @module client/ui/DiagnoseBlock
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { requestAiDiagnosis } from '../api.js'
import type { AiDiagnoseFace, AiDiagnoseFailure } from '../../../market-contracts/src/contracts/ai-draft.js'
import { clientErrorMessage } from './error-message.js'
import type { Translate } from '../i18n.js'
import css from './form.module.css'

/** What the block needs. */
export interface DiagnoseBlockProps {
  t: Translate
  face: AiDiagnoseFace
  /** The facts the panel established about this failure. */
  failure: AiDiagnoseFailure
  /** Disabled while the dialog is saving something else. */
  disabled?: boolean
}

/** What the button says: a failure is explained as one, a state as a state. */
function askLabel(t: Translate, state: string, answered: boolean): string {
  if (answered) return t('aiDiagnoseAgain')
  return state === 'failed' ? t('aiDiagnoseAsk') : t('aiDiagnoseAskState')
}

/** The language the explanation should be written in. */
function explainLocale(t: Translate): 'zh' | 'en' {
  return String(t('localeProbeLang')).toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function DiagnoseBlock(props: DiagnoseBlockProps): ReactNode {
  const { t, face, failure, disabled } = props
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const explain = (): void => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    requestAiDiagnosis({ face, failure, locale: explainLocale(t) })
      .then(result => {
        setAnswer(result.text)
      })
      .catch(caught => {
        const code = typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
        setError(code === 'ai-provider-limited' ? t('aiDraftLimited') : clientErrorMessage(t, caught))
      })
      .finally(() => setBusy(false))
  }
  return h(
    'div',
    { className: css.diagnoseBlock, 'data-ai-diagnose': face },
    h(
      Button,
      { variant: 'outline', size: 'sm', disabled: disabled === true || busy, onClick: explain },
      busy ? t('aiDiagnoseBusy') : askLabel(t, failure.state, answer !== undefined)
    ),
    error === undefined ? null : h('p', { className: css.aiError, role: 'alert' }, error),
    answer === undefined ? null : h('p', { className: css.diagnoseAnswer }, answer)
  )
}
