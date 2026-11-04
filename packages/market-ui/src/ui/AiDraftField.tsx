/**
 * The AI draft field: ask for an artifact, then review it.
 *
 * It is one row, because a draft is not a workflow: the person says what they want, the model
 * answers with the artifact, and the artifact lands in the editor they are already looking
 * at. Nothing saves.
 *
 * Two facts follow the answer. The line under the row names the model and what the call cost,
 * so nobody pays for a draft without knowing it. And the draft is reversible: a button gives
 * back the text that was there before it, because a suggestion you cannot undo is a change you
 * did not ask for.
 *
 * The field is shared by every surface that has an authored text — a skill, a command, a
 * role, an output style, a block for the system prompt — because the question and the review
 * step are the same on all of them.
 *
 * @module client/ui/AiDraftField
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { requestAiDraft, requestAiSession } from '../api.js'
import type { AiDraftFace, AiUsage } from '../../../market-contracts/src/contracts/ai-draft.js'
import { clientErrorMessage } from './error-message.js'
import type { Translate } from '../i18n.js'
import css from './form.module.css'

export interface AiDraftFieldProps {
  t: Translate
  face: AiDraftFace
  /** The session whose default model and language apply. */
  sessionId?: string
  /**
   * The whole document as it stands, when the face edits one text.
   *
   * Undo restores this. A face that edits fields apart from the raw text supplies
   * `onRestore` instead, because only it knows how its draft was unpacked.
   */
  documentText?: string
  /** Called with the draft; the editor replaces its document with it. */
  onDrafted: (text: string) => void
  /** Restores what the editor held before the draft, for a face that unpacks it. */
  onRestore?: () => void
  /**
   * Where a session's artifact lands, when this face has one.
   *
   * The button that opens a session is the way to adjust a requirement and pick a model: the
   * task is written as the session's first message, and the rest is the reader's own
   * conversation. Absent where a session has no file to land in.
   */
  session?: { dir?: string; path?: string; name?: string }
  /** Disabled while the editor is saving. */
  disabled?: boolean
}

/** The language the artifact should be authored in, read from the dictionary in force. */
function draftLocale(t: Translate): 'zh' | 'en' {
  return String(t('localeProbeLang')).toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/** The cost line: the model that answered, and what it spent when the provider said so. */
function costLine(t: Translate, model: string, usage: AiUsage | undefined): string {
  if (usage === undefined) return t('aiDraftDone', { model })
  return t('aiDraftDoneUsage', { model, input: String(usage.inputTokens), output: String(usage.outputTokens) })
}

export function AiDraftField(props: AiDraftFieldProps): ReactNode {
  const { t, face, sessionId, documentText, onDrafted, onRestore, disabled, session: sessionTarget } = props
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  // The restore step for the answer on screen, if it has one.
  const [undo, setUndo] = useState<(() => void) | undefined>(undefined)
  const [sessionNote, setSessionNote] = useState<string | undefined>(undefined)
  const openSession = (): void => {
    if (intent.trim() === '' || busy || sessionTarget === undefined) return
    setBusy(true)
    setError(undefined)
    setSessionNote(undefined)
    requestAiSession({
      face,
      intent,
      locale: draftLocale(t),
      ...(sessionId === undefined ? {} : { sessionId }),
      mode: sessionTarget.path === undefined ? 'create' : 'edit',
      ...(sessionTarget.dir === undefined ? {} : { dir: sessionTarget.dir }),
      ...(sessionTarget.path === undefined ? {} : { path: sessionTarget.path }),
      ...(sessionTarget.name === undefined ? {} : { name: sessionTarget.name })
    })
      .then(started => {
        // The session is listed under its workspace; naming that workspace is what lets the
        // reader find it.
        const where =
          started.workspace === undefined
            ? undefined
            : started.workspace
                .split('/')
                .filter(segment => segment !== '')
                .pop()
        setSessionNote(where === undefined ? t('aiSessionOpened') : t('aiSessionOpenedIn', { workspace: where }))
      })
      .catch(caught => {
        const code = typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
        setError(code === 'ai-provider-limited' ? t('aiDraftLimited') : clientErrorMessage(t, caught))
      })
      .finally(() => setBusy(false))
  }
  const draft = (): void => {
    if (intent.trim() === '' || busy) return
    const before = documentText
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    setUndo(undefined)
    requestAiDraft({ face, intent, locale: draftLocale(t), ...(sessionId === undefined ? {} : { sessionId }) })
      .then(result => {
        onDrafted(result.text)
        setNote(costLine(t, result.model, result.usage))
        // A second press on the same intent is a redraft: it replaces the answer above rather
        // than leaving two drafts' worth of text in the editor.
        if (onRestore !== undefined || before !== undefined) {
          setUndo(() => () => {
            if (onRestore !== undefined) onRestore()
            else if (before !== undefined) onDrafted(before)
            setNote(undefined)
            setUndo(undefined)
          })
        }
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
    sessionTarget === undefined
      ? null
      : h(
          Button,
          {
            variant: 'ghost',
            size: 'sm',
            disabled: disabled === true || busy || intent.trim() === '',
            title: t('aiDraftSessionHint'),
            onClick: openSession
          },
          t('aiDraftSession')
        ),
    undo === undefined
      ? null
      : h(
          Button,
          {
            variant: 'ghost',
            size: 'sm',
            disabled: disabled === true || busy,
            title: t('aiDraftUndoHint'),
            onClick: () => {
              undo()
            }
          },
          t('aiDraftUndo')
        ),
    (error ?? note ?? sessionNote) === undefined
      ? null
      : h('span', { className: error === undefined ? css.aiNote : css.aiError, role: error === undefined ? 'status' : 'alert' }, error ?? note ?? sessionNote)
  )
}
