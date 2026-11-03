/**
 * The AI draft field: ask for an artifact, then review it.
 *
 * It is one row, because a draft is not a workflow: the person says what they want, the model
 * answers with the artifact, and the artifact lands in the editor they are already looking
 * at. Nothing saves. The line under the row says which model produced it, so the reader can
 * judge the answer the way they would judge any other suggestion.
 *
 * The field is shared by every surface that has an authored text — a skill, a command, a
 * role, an output style, a block for the system prompt — because the question and the review
 * step are the same on all of them.
 *
 * @module client/ui/AiDraftField
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { requestAiDraft } from '../api.js'
import type { AiDraftFace } from '../../../market-contracts/src/contracts/ai-draft.js'
import { clientErrorMessage } from './error-message.js'
import type { Translate } from '../i18n.js'
import css from './form.module.css'

export interface AiDraftFieldProps {
  t: Translate
  face: AiDraftFace
  /** The session whose default model and language apply. */
  sessionId?: string
  /** Called with the draft; the editor replaces its document with it. */
  onDrafted: (text: string) => void
  /** Disabled while the editor is saving. */
  disabled?: boolean
}

/** The language the artifact should be authored in, read from the dictionary in force. */
function draftLocale(t: Translate): 'zh' | 'en' {
  return String(t('localeProbeLang')).toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function AiDraftField(props: AiDraftFieldProps): ReactNode {
  const { t, face, sessionId, onDrafted, disabled } = props
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const draft = (): void => {
    if (intent.trim() === '' || busy) return
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    requestAiDraft({ face, intent, locale: draftLocale(t), ...(sessionId === undefined ? {} : { sessionId }) })
      .then(result => {
        onDrafted(result.text)
        setNote(t('aiDraftDone', { model: result.model }))
      })
      .catch(caught => {
        // A limit is not a defect: say so in the reader's language instead of echoing the
        // provider's JSON at them.
        const code = typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
        setError(code === 'ai-provider-limited' ? t('aiDraftLimited') : clientErrorMessage(t, caught))
      })
      .finally(() => setBusy(false))
  }
  return h(
    'div',
    { className: css.aiField, 'data-ai-draft': face },
    h('span', { className: css.aiLabel }, t('aiDraftLabel')),
    h(Input, {
      value: intent,
      disabled: disabled === true || busy,
      placeholder: t('aiDraftPlaceholder'),
      'aria-label': t('aiDraftLabel'),
      onChange: (event: { target: { value: string } }) => setIntent(event.target.value),
      onKeyDown: (event: { key: string; preventDefault(): void }) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          draft()
        }
      }
    }),
    h(Button, { variant: 'outline', size: 'sm', disabled: disabled === true || busy || intent.trim() === '', onClick: draft }, busy ? t('aiDraftBusy') : t('aiDraftAction')),
    (error ?? note) === undefined ? null : h('span', { className: error === undefined ? css.aiNote : css.aiError, role: error === undefined ? 'status' : 'alert' }, error ?? note)
  )
}
