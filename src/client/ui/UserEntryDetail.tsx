/**
 * Detail dialog for one user-panel entry (skill, command, or persona role):
 * where it comes from, what it says, and the document itself, readable in
 * place through the host disclosure row.
 * @module client/ui/UserEntryDetail
 */
import { createElement as h, useState, type ReactNode } from 'react'
import { Button, StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './DetailModal.js'
import { MarkdownDocument } from './MarkdownDocument.js'
import { DetailRow, DetailRows } from './DetailRows.js'
import { lastChangeLabel } from './last-change.js'
import type { Translate } from '../index.js'
import type { UserPanelEntry, UserPanelKind } from '../api.js'
import css from './panel.module.css'

const NOUN_KEY: Record<UserPanelKind, 'workspaceTabSkills' | 'workspaceTabCommands' | 'workspaceTabPersonas'> = {
  skills: 'workspaceTabSkills',
  commands: 'workspaceTabCommands',
  agents: 'workspaceTabPersonas'
}

/** Metadata keys the identity row already carries. */
const HIDDEN_META = new Set(['description', 'disabled', 'name'])

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
  const title = kind === 'commands' ? `/${entry.name}` : entry.name
  const docName = kind === 'skills' ? 'SKILL.md' : `${entry.name}.md`
  const metaPairs = Object.entries(entry.metadata).filter(([key]) => !HIDDEN_META.has(key))
  return h(
    DetailModal,
    {
      open: true,
      onClose: props.onClose,
      title,
      description: `${t(NOUN_KEY[kind])} · ${provenance}`,
      closeLabel: t('cancel'),
      footer: h(Button, { variant: 'ghost', onClick: props.onClose }, t('detailDone'))
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
        kv(t('sourceLabel'), entry.suiteName ?? t('panelSourceUser')),
        kv(t('detailTypeLabel'), entry.origin === 'user' ? t('panelSourceUser') : t('panelSourcePlugin')),
        kv(t('diskPathLabel'), entry.path, true),
        updated === null ? null : kv(t('updatedLabel'), updated),
        metaPairs.length === 0 ? null : kv(metaPairs.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · '), t('detailMetadata'))
      )
    ),
    entry.description === '' ? null : h('div', { className: css.block }, h('h4', { className: css.blockHead }, t('detailDescriptionLabel')), h('p', { className: css.detailProse }, entry.description)),
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

function kv(label: string, value: string, mono = false): ReactNode {
  return h('div', null, h('dt', { className: css.kvKey }, label), h('dd', { className: mono ? `${css.kvValue} ${css.kvValueMono}` : css.kvValue, title: value }, value))
}
