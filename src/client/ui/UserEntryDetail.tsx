/**
 * Detail dialog for one user-panel entry (skill, command, or persona role):
 * where it comes from, what it says, and the document itself, readable in
 * place through the host disclosure row.
 * @module client/ui/UserEntryDetail
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './DetailModal.js'
import { DocumentTranslationView } from './DocumentTranslation.js'
import { DetailRow, DetailRows, kvCell } from './DetailRows.js'
import { lastChangeLabel } from './last-change.js'
import { commandCallName } from '../../model/command-names.js'
import type { Translate } from '../index.js'
import { fetchDocumentTranslation, fetchUserPanelEntry, type UserPanelEntry, type UserPanelKind } from '../api.js'
import { useDisplayText } from './translated-text.js'
import { localeIsChinese } from './bilingual-text.js'
import { useTranslationEnabled } from './translation-enabled.js'
import { pollUntilTranslated } from './translation-settle.js'
import { clientErrorMessage } from './error-message.js'
import css from './panel.module.css'

export interface UserEntryDetailProps {
  sessionId?: string
  t: Translate
  kind: UserPanelKind
  entry: UserPanelEntry
  /** The panel's text view, and the switch that drives it. */
  showOriginal?: boolean
  onClose: () => void
}

/** The entry's document, its overview, and its metadata. */
export function UserEntryDetailModal(props: UserEntryDetailProps): ReactNode {
  const { t, kind, entry, sessionId } = props
  const [open, setOpen] = useState(false)
  // The document arrives with the entry read, not with the list the dialog was
  // opened from, so the row shows a loading line until it lands.
  const [document, setDocument] = useState<string | undefined>(undefined)
  const [documentError, setDocumentError] = useState<string | undefined>(undefined)
  const entryId = entry.id ?? entry.name
  const target = localeIsChinese(t) ? 'zh' : 'en'
  const enabled = useTranslationEnabled()
  const initialTarget = useRef(target)
  const [localized, setLocalized] = useState<{ target: string; id: string; entry: UserPanelEntry }>()
  const previousEnabled = useRef(enabled)
  useEffect(() => {
    const reenabled = enabled && !previousEnabled.current
    previousEnabled.current = enabled
    if (!enabled || (initialTarget.current === target && !reenabled && (entry.translationPending ?? 0) === 0)) return
    let current = true
    let poll: { stop: () => void } | undefined
    const read = async (): Promise<{ value: UserPanelEntry; pending: number }> => {
      const value = await fetchUserPanelEntry(kind, entryId, sessionId)
      return { value, pending: value.translationPending ?? 0 }
    }
    const report = (value: UserPanelEntry): void => { if (current) setLocalized({ target, id: entryId, entry: value }) }
    void read().then(first => {
      if (!current) return
      report(first.value)
      if (first.pending > 0) poll = pollUntilTranslated({ read, report, isStopped: () => !current })
    }).catch(() => {})
    return () => { current = false; poll?.stop() }
  }, [target, enabled, entryId, kind, sessionId, entry.translationPending])
  const translatedDescription = localized?.target === target && localized.id === entryId
    ? localized.entry.translatedDescription : initialTarget.current === target ? entry.translatedDescription : undefined
  useEffect(() => {
    if (!open) return
    let current = true
    setDocument(undefined)
    setDocumentError(undefined)
    // The session address is appended only when the caller has one: a plain panel
    // read stays the two-argument call it has always been.
    void (sessionId === undefined ? fetchUserPanelEntry(kind, entryId) : fetchUserPanelEntry(kind, entryId, sessionId))
      .then(loaded => {
        if (current) setDocument(loaded.rawText)
      })
      .catch((reason: unknown) => {
        if (current) setDocumentError(clientErrorMessage(t, reason))
      })
    return () => {
      current = false
    }
  }, [open, kind, entryId, sessionId])
  const updated = entry.updatedAt === undefined || entry.updatedAt === null ? null : lastChangeLabel(t, entry.updatedAt)
  const provenance = entry.origin === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')
  // A command registers under its flattened call name and every other kind under
  // its own name; a name is never translated, so the dialog title reads the same
  // in either view.
  const view = { original: props.showOriginal === true }
  // Only the description flips with the view.
  const title = kind === 'commands' ? commandCallName(entry.name) : entry.name
  const description = useDisplayText(translatedDescription, entry.description, t, view)
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
              : h(DocumentTranslationView, {
                  t,
                  // The authored body is what renders until the reader flips the
                  // control; the component swaps the body rather than stacking a
                  // second copy of the document under the first.
                  original: document,
                  load: () => fetchDocumentTranslation(kind, entryId, sessionId)
                }))
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
