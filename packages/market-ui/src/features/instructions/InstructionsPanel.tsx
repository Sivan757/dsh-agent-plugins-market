/**
 * Workspace instructions panel: the AGENTS.md chain one session injects.
 *
 * Every status on this page is the server's report of the host renderer's own
 * answer, so a row can never claim more than the model receives. The page edits
 * the same files through the same chain: a row that exists is editable and
 * deletable, a row the server synthesized for a directory with no file offers
 * creation, and both go through the modal and editor conventions the other
 * resource panels use.
 * @module features/instructions/InstructionsPanel
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InstructionDeleteResult, InstructionRow, InstructionsPayload, InstructionScope } from '../../api.js'
import { deleteInstructionFile, fetchInstructions, saveInstructionFile } from '../../api.js'
import type { Translate } from '../../i18n.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { CodeEditor } from '../../ui/CodeEditor.js'
import { DetailModal } from '../../ui/DetailModal.js'
import { ConfirmModal, PanelActions, PanelHeader, type PanelConfirmState } from '../../ui/panel.js'
import { budgetPercent, isOverBudget, statusLocaleKey, statusTone } from './instructions-view-model.js'
import css from './instructions.module.css'

/** The one drafting session the editor holds. */
interface EditorState {
  scope: InstructionScope
  directory: string
  candidate: string
  displayPath: string
  text: string
  exists: boolean
}

interface InstructionsPanelProps {
  t: Translate
  /** The live session whose workspace to describe; omitted means the host process directory. */
  sessionId?: string
}

/** UTF-8 byte length, the unit both the budget and the source cap count in. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** The workspace instruction surface. */
export function InstructionsPanel({ t, sessionId }: InstructionsPanelProps): ReactNode {
  const [payload, setPayload] = useState<InstructionsPayload | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [editor, setEditor] = useState<EditorState | undefined>(undefined)
  const [confirm, setConfirm] = useState<PanelConfirmState | undefined>(undefined)

  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchInstructions(sessionId)
      .then(setPayload)
      .catch(caught => setError(clientErrorMessage(t, caught)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // The chain follows the session, so a different session is a different read.
  }, [sessionId])

  const openEditor = (row: InstructionRow): void => {
    setNotice(undefined)
    setError(undefined)
    // The read carries each existing file's text, so the editor opens on what is
    // on disk. A file over the per-file cap carries none, and its draft starts
    // empty rather than showing content the host refuses to load.
    setEditor({ scope: row.scope, directory: row.directory, candidate: row.candidate, displayPath: row.displayPath, text: row.content ?? '', exists: row.exists })
  }

  const save = async (draft: EditorState): Promise<boolean> => {
    try {
      await saveInstructionFile({ scope: draft.scope, directory: draft.directory, candidate: draft.candidate, text: draft.text }, sessionId)
      setEditor(undefined)
      refresh()
      return true
    } catch (caught) {
      setError(clientErrorMessage(t, caught))
      return false
    }
  }

  const askDelete = (target: { scope: InstructionScope; directory: string; candidate: string; displayPath: string }): void => {
    const row = target
    setNotice(undefined)
    setConfirm({
      title: t('instructionsDeleteTitle', { path: row.displayPath }),
      description: t('instructionsDeleteDesc'),
      onConfirm: async () => {
        const result = await deleteInstructionFile({ scope: row.scope, directory: row.directory, candidate: row.candidate }, sessionId)
        reportDeletion(t, result, setNotice)
        refresh()
      }
    })
  }

  if (payload === undefined) {
    return h(
      'div',
      { className: css.surface },
      h(PanelHeader, { subtitle: t('instructionsSubtitle') }),
      h('div', { className: css.empty }, loading ? t('loading') : t('instructionsErrorTitle'))
    )
  }

  if (!payload.available) {
    return h(
      'div',
      { className: css.surface },
      h(PanelHeader, { subtitle: t('instructionsSubtitle') }),
      h(
        'section',
        { className: css.unavailable, role: 'status', 'data-instructions-unavailable': true },
        h('h3', { className: css.unavailableTitle }, t('instructionsUnavailableTitle')),
        h('p', { className: css.unavailableBody }, t('instructionsUnavailableBody', { package: '@deepseek-ai/dsh-agent-instructions' }))
      )
    )
  }

  const percent = budgetPercent(payload.total, payload.budget)
  const over = isOverBudget(payload.total, payload.budget)
  const disabled = !(payload.budget > 0)

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, {
      subtitle: t('instructionsSubtitle'),
      actions: h(PanelActions, { refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
    }),
    error === undefined ? null : h('div', { className: css.error, role: 'alert' }, error),
    payload.error === undefined ? null : h('div', { className: css.error, role: 'alert' }, t('instructionsErrorTitle'), ' ', payload.error),
    notice === undefined ? null : h('div', { className: css.notice, role: 'status' }, notice),
    h(
      'section',
      { className: css.budget, 'data-instructions-budget': true },
      h(
        'div',
        { className: css.budgetHead },
        h('span', null, t('instructionsBudgetLabel')),
        h('span', { className: css.budgetUsage }, t('instructionsBudgetUsage', { used: payload.total, budget: payload.budget }))
      ),
      h(
        'div',
        { className: css.budgetTrack, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent },
        h('div', { className: over ? `${css.budgetFill} ${css.budgetFillOver}` : css.budgetFill, style: { width: `${percent}%` } })
      ),
      h('p', { className: css.budgetRule }, disabled ? t('instructionsBudgetDisabled') : t('instructionsBudgetRule'))
    ),
    // The user-level chain only: the project rows and the session directory answer questions
    // about where the session runs, which the row's own tabs already answer. One card per
    // file, and a click opens it the way every other panel opens an entry.
    h(
      'div',
      { className: css.cards },
      payload.rows
        .filter(row => row.scope !== 'project')
        .map(row =>
          h(
            'button',
            {
              key: `${row.scope}:${row.directory}:${row.candidate}`,
              type: 'button',
              className: css.card,
              'data-instruction-status': row.status,
              onClick: () => openEditor(row)
            },
            h('code', { className: css.cardName }, row.displayPath),
            h('span', { className: css.cardMeta }, h(Tag, { tone: statusTone(row.status) }, t(statusLocaleKey(row.status)))),
            row.size === undefined ? null : h('span', { className: css.cardSize }, t('instructionsRowSize', { bytes: row.size }))
          )
        )
    ),
    h(
      'section',
      { className: css.preview, 'data-instructions-preview': true },
      h('h3', { className: css.groupTitle }, t('instructionsPreviewTitle')),
      payload.rendered.text === '' ? h('p', { className: css.empty }, t('instructionsPreviewEmpty')) : h('pre', { className: css.previewText }, payload.rendered.text),
      payload.rendered.omitted.length === 0
        ? null
        : h('p', { className: css.previewMeta }, t('instructionsPreviewOmitted', { paths: payload.rendered.omitted.map(file => file.displayPath).join(', ') })),
      payload.rendered.truncated.length === 0
        ? null
        : h(
            'p',
            { className: css.previewMeta },
            t('instructionsPreviewTruncated', { paths: payload.rendered.truncated.map(item => `${item.displayPath} (${item.includedBytes}/${item.originalBytes})`).join(', ') })
          )
    ),
    editor === undefined
      ? null
      : h(InstructionEditor, {
          t,
          draft: editor,
          maxSourceBytes: payload.maxSourceBytes,
          onChange: setEditor,
          onClose: () => setEditor(undefined),
          onSave: save,
          error,
          // Deleting lives in the dialog the card opened, the way every other panel keeps its
          // destructive action one step inside the entry rather than on the list.
          onDelete: editor.exists
            ? () => {
                const target = editor
                setEditor(undefined)
                askDelete(target)
              }
            : undefined
        }),
    h(ConfirmModal, { state: confirm, confirmLabel: t('panelDelete'), cancelLabel: t('cancel'), onClose: () => setConfirm(undefined) })
  )
}

/** Report what a deletion did to the other names that resolved to the same file. */
function reportDeletion(t: Translate, result: InstructionDeleteResult, setNotice: (text: string) => void): void {
  const parts: string[] = []
  if (result.aliases.length > 0) parts.push(t('instructionsDeleteAliases', { paths: result.aliases.join(', ') }))
  if (result.targetIsLink) parts.push(t('instructionsDeleteLink'))
  if (parts.length > 0) setNotice(parts.join(' '))
}

/** The editor dialog: one candidate's whole document, with both limits live. */
function InstructionEditor(props: {
  t: Translate
  draft: EditorState
  maxSourceBytes: number
  error: string | undefined
  onChange: (draft: EditorState) => void
  onClose: () => void
  onSave: (draft: EditorState) => Promise<boolean>
  /** Removes the file the dialog shows; omitted for a file that does not exist yet. */
  onDelete?: () => void
}): ReactNode {
  const { t, draft, maxSourceBytes, error, onChange, onClose, onSave, onDelete } = props
  const [busy, setBusy] = useState(false)
  const bytes = byteLength(draft.text)
  const overLimit = bytes > maxSourceBytes
  return h(
    DetailModal,
    {
      open: true,
      size: 'lg',
      onClose,
      title: draft.exists ? t('instructionsEditTitle', { path: draft.displayPath }) : t('instructionsCreateTitle', { path: draft.displayPath }),
      closeLabel: t('cancel'),
      footer: h(
        'div',
        { className: css.footer },
        h('span', { className: overLimit ? `${css.footerCount} ${css.footerCountOver}` : css.footerCount }, t('instructionsByteCount', { bytes, limit: maxSourceBytes })),
        overLimit ? h('span', { className: css.footerHint }, t('instructionsOverLimit', { limit: maxSourceBytes })) : null,
        error === undefined ? null : h('span', { className: css.footerError, role: 'alert' }, error),
        h('div', { className: css.grow }),
        onDelete === undefined ? null : h(Button, { variant: 'ghost', onClick: onDelete }, t('panelDelete')),
        h(Button, { variant: 'outline', onClick: onClose }, t('cancel')),
        h(
          Button,
          {
            variant: 'primary',
            disabled: busy || overLimit,
            onClick: () => {
              setBusy(true)
              void onSave(draft).finally(() => setBusy(false))
            }
          },
          t('save')
        )
      )
    },
    h(CodeEditor, {
      value: draft.text,
      onChange: (text: string) => {
        onChange({ ...draft, text })
      },
      language: 'markdown',
      label: t('instructionsTextLabel'),
      minHeight: 300
    })
  )
}
