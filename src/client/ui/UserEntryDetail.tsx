/**
 * Detail dialog for one user-panel entry (skill, command, or persona role):
 * where it comes from, what it says, and the document itself, readable in
 * place through the host disclosure row.
 * @module client/ui/UserEntryDetail
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './DetailModal.js'
import { MarkdownDocument } from './MarkdownDocument.js'
import { DetailRow, DetailRows, kvCell } from './DetailRows.js'
import { lastChangeLabel } from './last-change.js'
import { commandCallName } from '../../model/command-names.js'
import type { Translate } from '../index.js'
import type { UserPanelEntry, UserPanelKind } from '../api.js'
import { displayText } from './translated-text.js'
import css from './panel.module.css'

export interface UserEntryDetailProps {
  t: Translate
  kind: UserPanelKind
  entry: UserPanelEntry
  onClose: () => void
}

/** The entry's document, its overview, and its metadata. */
export function UserEntryDetailModal(props: UserEntryDetailProps): ReactNode {
  const { t, kind, entry } = props
  const [open, setOpen] = useState(false)
  const updated = entry.updatedAt === undefined || entry.updatedAt === null ? null : lastChangeLabel(t, entry.updatedAt)
  const provenance = entry.origin === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')
  // A command registers under its flattened call name, which is the identity the
  // user types, so its dialog keeps that name untranslated; a skill and a persona
  // are recognized by their name, which reads translated.
  const title = kind === 'commands' ? commandCallName(entry.name) : (displayText(entry.translatedName, entry.name, t) ?? entry.name)
  const description = displayText(entry.translatedDescription, entry.description, t)
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
    description === undefined || description === '' ? null : h('div', { className: css.block }, h('h4', { className: css.blockHead }, t('detailDescriptionLabel')), h('p', { className: css.detailProse }, description)),
    h(
      'div',
      { className: css.block },
      h('h4', { className: css.blockHead }, t(kind === 'skills' ? 'docSectionSkill' : kind === 'commands' ? 'docSectionCommand' : 'docSectionPersona')),
      h(
        DetailRows,
        null,
        h(DetailRow, { name: docName, summary: t('detailDocHint'), open, onToggle: () => setOpen(!open), children: h(MarkdownDocument, { text: entry.rawText, t }) })
      )
    )
  )
}

/**
 * Routing frontmatter rows for agent personas: model, provider, reasoning
 * effort, and the tools the persona may call. These keys steer how the agent
 * runs, so each gets its own labelled row rather than a line of raw YAML.
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
    model === undefined ? null : kvCell(t('detailModelLabel'), model, true, 'model'),
    provider === undefined ? null : kvCell(t('detailProviderLabel'), provider, true, 'provider'),
    reasoning === undefined ? null : kvCell(t('detailReasoningLabel'), reasoning, true, 'reasoning'),
    tools === undefined ? null : kvCell(t('detailToolsLabel'), tools, true, 'tools')
  ]
}
