/**
 * Detail dialog for one user-panel entry (skill, command, or persona role):
 * where it comes from, what it says, and the document itself, readable in
 * place through the host disclosure row.
 * @module client/ui/UserEntryDetail
 */
import { createElement as h, Fragment, useEffect, useState, type ReactNode } from 'react'
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './DetailModal.js'
import { MarkdownDocument } from './MarkdownDocument.js'
import { DocumentTranslationView } from './DocumentTranslation.js'
import { DetailRow, DetailRows, kvCell } from './DetailRows.js'
import { lastChangeLabel } from './last-change.js'
import { commandCallName } from '../../model/command-names.js'
import type { Translate } from '../index.js'
import { fetchDocumentTranslation, fetchUserPanelEntry, type UserPanelEntry, type UserPanelKind } from '../api.js'
import { displayText } from './translated-text.js'
import { clientErrorMessage } from './error-message.js'
import css from './panel.module.css'

export interface UserEntryDetailProps {
  t: Translate
  kind: UserPanelKind
  entry: UserPanelEntry
  /** The panel's text view, and the switch that drives it. */
  showOriginal?: boolean
  onClose: () => void
}

/** The entry's document, its overview, and its metadata. */
export function UserEntryDetailModal(props: UserEntryDetailProps): ReactNode {
  const { t, kind, entry } = props
  const [open, setOpen] = useState(false)
  // The document arrives with the entry read, not with the list the dialog was
  // opened from, so the row shows a loading line until it lands.
  const [document, setDocument] = useState<string | undefined>(undefined)
  const [documentError, setDocumentError] = useState<string | undefined>(undefined)
  const entryId = entry.id ?? entry.name
  useEffect(() => {
    if (!open) return
    let current = true
    setDocument(undefined)
    setDocumentError(undefined)
    void fetchUserPanelEntry(kind, entryId)
      .then(loaded => {
        if (current) setDocument(loaded.rawText)
      })
      .catch((reason: unknown) => {
        if (current) setDocumentError(clientErrorMessage(t, reason))
      })
    return () => {
      current = false
    }
  }, [open, kind, entryId])
  const updated = entry.updatedAt === undefined || entry.updatedAt === null ? null : lastChangeLabel(t, entry.updatedAt)
  const provenance = entry.origin === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')
  // A command registers under its flattened call name and every other kind under
  // its own name; a name is never translated, so the dialog title reads the same
  // in either view.
  const view = { original: props.showOriginal === true }
  // Only the description flips with the view.
  const title = kind === 'commands' ? commandCallName(entry.name) : entry.name
  const description = displayText(entry.translatedDescription, entry.description, t, view)
  const docName = kind === 'skills' ? 'SKILL.md' : `${entry.name}.md`
  return h(
    DetailModal,
    {
      open: true,
      onClose: props.onClose,
      title,
      closeLabel: t('cancel')
    },
    h(
      'div',
      { className: css.hero },
      h(StateDot, { state: entry.disabled ? 'idle' : 'done' }),
      h(
        'div',
        { className: css.heroText },
        h(
          'div',
          { className: css.heroLine },
          h(Tag, { tone: entry.disabled ? 'quiet' : 'success' }, entry.disabled ? t('disabledLabel') : t('enabledLabel')),
          h(Tag, null, provenance),
          entry.suiteName === undefined ? null : h(Tag, { tone: 'quiet' }, entry.suiteName)
        ),
        h('p', { className: css.heroMono }, entry.path)
      )
    ),
    h(
      'div',
      { className: css.block },
      h('h4', { className: css.blockHead }, t('overviewSection')),
      h(
        'dl',
        { className: css.kvGrid },
        kvCell(t('sourceLabel'), entry.suiteName ?? t('panelSourceUser')),
        kvCell(t('detailTypeLabel'), entry.origin === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')),
        kvCell(t('diskPathLabel'), entry.path, true),
        updated === null ? null : kvCell(t('updatedLabel'), updated),
        kind === 'agents' ? routingRows(t, entry.metadata) : null
      )
    ),
    description === undefined || description === ''
      ? null
      : h(
          'div',
          { className: css.block },
          h('h4', { className: css.blockHead }, t('detailDescriptionLabel')),
          h('p', { className: css.detailProse }, description)
        ),
    h(
      'div',
      { className: css.block },
      h('h4', { className: css.blockHead }, t(kind === 'skills' ? 'docSectionSkill' : kind === 'commands' ? 'docSectionCommand' : 'docSectionPersona')),
      h(
        DetailRows,
        null,
        h(DetailRow, {
          name: docName,
          summary: t('detailDocHint'),
          open,
          onToggle: () => setOpen(!open),
          children:
            documentError ??
            (document === undefined
              ? t('loading')
              : h(
                  Fragment,
                  null,
                  h(MarkdownDocument, { text: document, t }),
                  // The translation is its own section under the document rather
                  // than a second view of it: a reader who wants the Chinese
                  // reads the whole file in one place, and one who does not never
                  // pays for it.
                  h(DocumentTranslationView, { t, load: () => fetchDocumentTranslation(kind, entryId) })
                ))
        })
      )
    )
  )
}

/**
 * Routing frontmatter rows for agent personas: the model provider, the model,
 * the reasoning effort, and the tools the persona may call. A persona that
 * declares none of the first three runs on the session's own route, so that
 * row says so instead of disappearing — the reader is asking what this agent
 * will run on, and a missing row cannot answer that.
 */
function routingRows(t: Translate, metadata: Record<string, unknown>): ReactNode {
  const model = typeof metadata['model'] === 'string' ? metadata['model'] : undefined
  const provider = typeof metadata['provider'] === 'string' ? metadata['provider'] : undefined
  const snake = typeof metadata['reasoning_effort'] === 'string' ? metadata['reasoning_effort'] : undefined
  const camel = typeof metadata['reasoningEffort'] === 'string' ? metadata['reasoningEffort'] : undefined
  const reasoning = snake ?? camel
  const tools = Array.isArray(metadata['tools'])
    ? metadata['tools'].map(tool => String(tool)).join(', ')
    : typeof metadata['tools'] === 'string'
      ? metadata['tools']
      : undefined
  return [
    kvCell(t('personaProvider'), provider ?? t('personaInherit'), true, 'provider'),
    kvCell(t('personaModel'), model ?? t('personaInherit'), true, 'model'),
    kvCell(t('personaReasoningEffort'), reasoning ?? t('personaEffortAutomatic'), true, 'reasoning'),
    tools === undefined ? null : kvCell(t('detailToolsLabel'), tools, true, 'tools')
  ]
}
