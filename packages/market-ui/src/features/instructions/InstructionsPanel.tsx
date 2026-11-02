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
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InstructionDeleteResult, InstructionRow, InstructionsPayload, InstructionScope } from '../../api.js'
import { deleteInstructionFile, fetchInstructions, saveInstructionFile } from '../../api.js'
import type { Translate } from '../../i18n.js'
import { clientErrorMessage } from '../../ui/error-message.js'
import { CodeEditor } from '../../ui/CodeEditor.js'
import { ResourceSurface } from '../../ui/ResourceSurface.js'
import { DetailModal } from '../../ui/DetailModal.js'
import { ConfirmModal, PanelActions, PanelHeader, ReadFailed, type PanelConfirmState } from '../../ui/panel.js'
import { InstructionDetail } from './InstructionDetail.js'
import { statusLocaleKey } from './instructions-view-model.js'
import css from './instructions.module.css'
import panelCss from '../../ui/panel.module.css'

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

/**
 * The scope as a reader names it.
 *
 * @param t - the dictionary.
 * @param row - the chain entry.
 * @returns the scope label, naming the root when the row is user-global.
 */
function scopeName(t: Translate, row: InstructionRow): string {
  if (row.scope === 'project') return t('instructionsGroupProject')
  return row.scope === 'agents-global' ? t('instructionsScopeAgentsGlobal') : t('instructionsScopeUserGlobal')
}

/** UTF-8 byte length, the unit the per-file source cap counts in. */
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
  /** The chain entry the reader opened: reading first, editing on request. */
  const [detail, setDetail] = useState<InstructionRow | undefined>(undefined)
  const [createOpen, setCreateOpen] = useState(false)
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

  // One tree for every state. The toolbar and the list box exist from the first
  // paint, so a tab switch never moves the panel's content: the earlier version
  // returned a header-only skeleton while loading, and the toolbar and list then
  // appeared under it, shifting everything down.
  const rows = payload === undefined ? [] : payload.rows
  /** Candidates the host would load but that do not exist yet: what 新建 can create. */
  const missingRows = rows.filter(row => !row.exists)
  if (payload !== undefined && !payload.available) {
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

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, {
      subtitle: t('instructionsSubtitle'),
      actions: h(
        'div',
        { className: css.headerActions },
        // Which file to create is the reader's question, not a default: the chain has one
        // candidate per root and the project's are the ones that go into the repository.
        h(Menu, {
          open: createOpen,
          onClose: () => setCreateOpen(false),
          portal: true,
          compact: true,
          align: 'end',
          anchor: h(
            Button,
            {
              size: 'sm',
              variant: 'ghost',
              'aria-label': t('instructionsCreate'),
              'aria-haspopup': 'menu',
              'aria-expanded': createOpen,
              disabled: missingRows.length === 0,
              onClick: () => setCreateOpen(value => !value)
            },
            t('instructionsCreate')
          ),
          items: missingRows.map(row => ({ id: `${row.scope}:${row.directory}:${row.candidate}`, label: row.displayPath + ' · ' + scopeName(t, row) })),
          onSelect: (id: string) => {
            setCreateOpen(false)
            const row = missingRows.find(entry => `${entry.scope}:${entry.directory}:${entry.candidate}` === id)
            if (row !== undefined) openEditor(row)
          }
        }),
        h(PanelActions, { refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
      )
    }),
    error === undefined ? null : h(ReadFailed, { message: error, retryLabel: t('readRetry'), onRetry: refresh }),
    payload?.error === undefined ? null : h('div', { className: css.error, role: 'alert' }, t('instructionsErrorTitle'), ' ', payload.error),
    notice === undefined ? null : h('div', { className: panelCss.notice, role: 'status' }, notice),
    // Only files that exist: a list of things that are not there cannot be seen, found, or used.
    h(ResourceSurface, {
      t,
      searchLabel: t('cardSearch'),
      searchPlaceholder: t('instructionsSearchPh'),
      // Two scopes, not a state cut: the chain is a handful of rows, the tag already names
      // each status, and a "loaded" tab would hide exactly the truncated row someone opens
      // the page to find. Which half a file belongs to is the question this page answers
      // second-most often ("where do I change this?"), and it used to be readable only off
      // each card's meta line.
      filters: [
        { id: 'user', label: t('instructionsGroupGlobal'), match: item => item.keywords === 'user' },
        { id: 'project', label: t('instructionsGroupProject'), match: item => item.keywords === 'project' }
      ],
      // No text toggle either: this surface shows paths, sizes and status words, and all
      // three are already in the reader's language — a switch between original and
      // translation had nothing to switch.
      // The settings page renders outside any session, so this read is the chain
      // under the host process directory. Saying so is the difference between a
      // reader trusting the two paths and wondering why their project's files are
      // missing. It rides the list box so the toolbar keeps its row.
      ...(sessionId === undefined ? { notice: h('p', { className: css.sessionHint, 'data-instructions-session-hint': true }, t('instructionsSessionHint')) } : {}),
      // Every existing candidate, in the host's own load order: the project half of the
      // chain used to be filtered out here, so a reader could not see — or create — the
      // files that actually live in their repository.
      entries: rows
        .filter(row => row.exists)
        .map(row => ({
          id: `${row.scope}:${row.directory}:${row.candidate}`,
          name: row.displayPath,
          tag: t(statusLocaleKey(row.status)),
          tagId: row.status,
          meta: row.size === undefined ? scopeName(t, row) : t('instructionsRowMeta', { scope: scopeName(t, row), bytes: String(row.size) }),
          // The filter reads the scope without showing it twice: keywords is search text the
          // card does not render.
          keywords: row.scope === 'project' ? 'project' : 'user'
        })),
      emptyText: error !== undefined || payload?.error !== undefined ? t('statusUnreadable') : loading ? t('loading') : t('instructionsPreviewEmpty'),
      onOpen: id => {
        const row = rows.find(entry => `${entry.scope}:${entry.directory}:${entry.candidate}` === id)
        if (row !== undefined) setDetail(row)
      }
    }),
    // Reading is its own step: a card opens the file, and the buttons inside it start
    // editing or deleting. Clicking a row used to drop the reader straight into an editor.
    detail === undefined || payload === undefined
      ? null
      : h(InstructionDetail, {
          t,
          row: detail,
          budget: payload.budget,
          onClose: () => setDetail(undefined),
          onEdit: () => {
            const row = detail
            setDetail(undefined)
            openEditor(row)
          },
          onDelete: () => {
            const row = detail
            setDetail(undefined)
            askDelete(row)
          }
        }),
    // The editor only opens from a row, and a row only exists once a read landed.
    editor === undefined || payload === undefined
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
